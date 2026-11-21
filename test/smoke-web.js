/**
 * End-to-end check of episodes 5 and 6 against a real HyphaBase environment, using .env:
 *
 *   npm run smoke:web
 *
 * Builds the web app, starts it on a free port and talks to it the way a
 * browser does, keeping the session cookie by hand. It proves the claims
 * the episode makes: no cookie and a made-up cookie get nothing; staff can
 * read but not add; the owner can add; bad input and a duplicate email are
 * refused with a message per field; staff can edit a customer but not
 * delete one, and the customer survives the attempt; the owner can delete;
 * signing out ends the session at HyphaBase; and the secret key is in
 * nothing the browser can download.
 *
 * Creates two throwaway users and two customers, and removes them afterwards
 * (the users only if the key has users.delete, see test/smoke-auth.js).
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { after, test } from "node:test";

import { addUser } from "../src/auth.js";
import { deleteCustomer, ensureCustomersCollection, listCustomers } from "../src/customers.js";
import { ApiError, createApi, loadConfig, requireLocation } from "../src/hyphabase.js";
import { ensureRole, giveRole, ROLES } from "../src/roles.js";

const config = loadConfig();
const api = createApi(config);
const locationId = requireLocation(config);
const web = path.join(import.meta.dirname, "..", "web");

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, [path.join(web, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, stdio: "ignore" });
after(() => app.kill());

async function untilReady() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(origin);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("The web app did not start. Run `npm run build` in web/ first.");
}

/** A browser, as far as the server can tell: it keeps the cookie it is given and sends it back. */
function browser() {
  let cookie = null;
  let lastSetCookie = null;
  return {
    get lastSetCookie() { return lastSetCookie; },
    set cookie(value) { cookie = value; },
    async request(method, route, body) {
      const response = await fetch(origin + route, {
        method,
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      for (const header of response.headers.getSetCookie()) {
        lastSetCookie = header;
        const [pair] = header.split(";");
        cookie = pair.endsWith("=") ? null : pair;
      }
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    },
  };
}

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
}

test("episodes 5 and 6: the web app", async () => {
  await ensureCustomersCollection(api);
  await untilReady();

  const run = Date.now().toString(36);
  const password = `Smoke-${crypto.randomUUID()}`;
  const { role: ownerRole } = await ensureRole(api, locationId, ROLES.owner);
  const { role: staffRole } = await ensureRole(api, locationId, ROLES.staff);
  const person = async (name, role) => {
    const email = `smoke-web-${name}-${run}@brightsideclean.example`;
    const user = await addUser(api, locationId, { name: `Smoke ${name}`, email, password });
    await giveRole(api, locationId, user.id, role.id);
    return { user, email };
  };
  const owner = await person("owner", ownerRole);
  const staff = await person("staff", staffRole);
  const customerEmail = `smoke-web-${run}@example.com`;
  const otherEmail = `smoke-web-other-${run}@example.com`;

  try {
    // Nobody: no cookie, then a cookie somebody made up.
    const stranger = browser();
    assert.equal((await stranger.request("GET", "/api/me")).status, 401);
    assert.equal((await stranger.request("GET", "/api/customers")).status, 401);
    stranger.cookie = `crm_session=${Buffer.from(JSON.stringify({ accessToken: "made-up", refreshToken: "made-up", expiresAt: "2099-01-01T00:00:00Z", user: { id: owner.user.id, name: "Smoke owner", email: owner.email }, locationIds: [locationId] })).toString("base64url")}`;
    assert.equal((await stranger.request("GET", "/api/customers")).status, 401, "a made-up cookie gets nothing");
    assert.equal((await stranger.request("POST", "/api/customers", { name: "Nobody", email: `nobody-${run}@example.com` })).status, 401);

    // A wrong password.
    assert.equal((await browser().request("POST", "/api/login", { email: staff.email, password: "not-the-password" })).status, 401);

    // Staff: signs in, reads, cannot add.
    const marcus = browser();
    const signedIn = await marcus.request("POST", "/api/login", { email: staff.email, password });
    assert.equal(signedIn.status, 200);
    assert.deepEqual(Object.keys(signedIn.body), ["user"], "the reply carries no token");
    assert.match(marcus.lastSetCookie, /HttpOnly/i);
    assert.match(marcus.lastSetCookie, /SameSite=strict/i);
    assert.deepEqual((await marcus.request("GET", "/api/me")).body.permissions, ROLES.staff.permissions);
    assert.equal((await marcus.request("GET", "/api/customers")).status, 200);
    const refused = await marcus.request("POST", "/api/customers", { name: "Smoke Web", email: customerEmail });
    assert.equal(refused.status, 403, "staff cannot add");
    assert.equal(refused.body.required_permission, "data.records.create");

    // Owner: bad input, then a real customer, then the same email again.
    const sarah = browser();
    assert.equal((await sarah.request("POST", "/api/login", { email: owner.email, password })).status, 200);
    const invalid = await sarah.request("POST", "/api/customers", { name: "", email: "not-an-email" });
    assert.equal(invalid.status, 422);
    assert.deepEqual(Object.keys(invalid.body.errors).sort(), ["email", "name"]);
    const added = await sarah.request("POST", "/api/customers", { name: "Smoke Web", email: customerEmail, phone: "555-0199" });
    assert.equal(added.status, 201);
    assert.equal(added.body.data.status, "lead", "the collection's default status");
    assert.equal((await sarah.request("POST", "/api/customers", { name: "Smoke Web", email: customerEmail })).status, 409, "the same email twice");
    const seen = await marcus.request("GET", "/api/customers");
    assert.ok(seen.body.data.some((c) => c.id === added.body.data.id), "staff sees the new customer");

    // Episode 6. Staff fixes one field; the others stay as they were.
    const customerPath = `/api/customers/${added.body.data.id}`;
    const fixed = await marcus.request("PATCH", customerPath, { phone: "555-0143" });
    assert.equal(fixed.status, 200, "staff can edit");
    assert.deepEqual(fixed.body.data, { ...added.body.data, phone: "555-0143" });
    const badEdit = await marcus.request("PATCH", customerPath, { email: "not-an-email" });
    assert.equal(badEdit.status, 422);
    assert.deepEqual(Object.keys(badEdit.body.errors), ["email"]);
    assert.equal((await marcus.request("PATCH", customerPath, {})).status, 422, "an edit has to change something");

    // Staff cannot delete, and the customer survives the attempt.
    const noDelete = await marcus.request("DELETE", customerPath);
    assert.equal(noDelete.status, 403, "staff cannot delete");
    assert.equal(noDelete.body.required_permission, "data.records.delete");
    assert.ok((await marcus.request("GET", "/api/customers")).body.data.some((c) => c.id === added.body.data.id), "the customer is still there");

    // Owner: edits, cannot take another customer's email, deletes.
    const cleared = await sarah.request("PATCH", customerPath, { status: "active", phone: "" });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.data, { ...added.body.data, status: "active", phone: null });
    assert.equal((await sarah.request("POST", "/api/customers", { name: "Smoke Other", email: otherEmail })).status, 201);
    assert.equal((await sarah.request("PATCH", customerPath, { email: otherEmail })).status, 409, "an email another customer has");
    assert.equal((await sarah.request("DELETE", customerPath)).status, 204, "the owner can delete");
    assert.ok(!(await marcus.request("GET", "/api/customers")).body.data.some((c) => c.id === added.body.data.id), "the customer is gone for everyone");
    assert.equal((await sarah.request("DELETE", customerPath)).status, 404, "deleting twice");
    assert.equal((await marcus.request("PATCH", customerPath, { phone: "555-0144" })).status, 404, "editing a deleted customer");
    assert.equal((await stranger.request("PATCH", customerPath, { phone: "555-0145" })).status, 401);
    assert.equal((await stranger.request("DELETE", customerPath)).status, 401);

    // Another site cannot use Sarah's browser.
    const forged = await fetch(`${origin}/api/customers`, { method: "POST", headers: { Origin: "https://elsewhere.example", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(forged.status, 403);

    // Signing out ends the session at HyphaBase, not only in the browser.
    const kept = sarah.lastSetCookie.split(";")[0];
    assert.equal((await sarah.request("POST", "/api/logout")).status, 204);
    assert.equal((await sarah.request("GET", "/api/me")).status, 401);
    sarah.cookie = kept;
    assert.equal((await sarah.request("GET", "/api/customers")).status, 401, "the old cookie no longer works");
    await marcus.request("POST", "/api/logout");

    // The secret key is in nothing a browser can download.
    const page = await (await fetch(origin)).text();
    assert.ok(!page.includes(config.key), "not in the page");
    const assets = await filesUnder(path.join(web, ".next", "static"));
    assert.ok(assets.length > 0);
    for (const file of assets) {
      assert.ok(!(await readFile(file, "utf8")).includes(config.key), `not in ${path.basename(file)}`);
    }
  } finally {
    for (const customer of await listCustomers(api)) {
      if ([customerEmail, otherEmail].includes(customer.email)) await deleteCustomer(api, customer.id);
    }
    for (const { user } of [owner, staff]) {
      try {
        await api.request(`/api/modules/employees/users/${user.id}`, { method: "DELETE", locationId });
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 403)) throw error;
        console.log(`Left user ${user.email} in place: the key has no users.delete scope.`);
      }
    }
  }
});
