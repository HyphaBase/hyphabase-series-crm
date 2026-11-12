import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { createApi } from "../src/hyphabase.js";
import { createApp } from "../src/server.js";
import { fakeFetch } from "./fake-fetch.js";

const servers = [];
after(() => servers.forEach((server) => server.close()));

/** Runs the CRM server on a free port, with HyphaBase replaced by canned answers. */
async function serverWith(...responses) {
  const { fetch, calls } = fakeFetch(...responses);
  const api = createApi({ url: "http://api.test", key: "sk_test_1", fetch });
  const server = createServer(createApp({ api, locationId: "loc-1" }));
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = "GET", token, body } = {}) => {
    const res = await globalThis.fetch(`${url}${path}`, {
      method,
      headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { "Content-Type": "application/json" }) },
      body: body && JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { call, calls };
}

const sarah = { id: "u1", name: "Sarah Mitchell", email: "sarah@brightsideclean.example" };
const marcus = { id: "u2", name: "Marcus Bell", email: "marcus@brightsideclean.example" };

// What HyphaBase answers when asked what a user may do.
const asOwner = { body: { permissions: ["data.records.read", "data.records.create", "data.records.delete"] } };
const asStaff = { body: { permissions: ["data.records.read"] } };
const noRole = { body: { permissions: [] } };
const CUSTOMER_ID = "f294a1f4-3625-49e3-a491-2e9ecc71769e";

test("GET /customers without a token is refused before HyphaBase is asked anything", async () => {
  const { call, calls } = await serverWith();

  const res = await call("/customers");

  assert.equal(res.status, 401);
  assert.equal(res.body.error, "Sign in first.");
  assert.equal(calls.length, 0);
});

test("GET /customers with a token HyphaBase rejects is refused, and no customers are read", async () => {
  const { call, calls } = await serverWith({ status: 401, body: { message: "Unauthenticated." } });

  const res = await call("/customers", { token: "made-up" });

  assert.equal(res.status, 401);
  assert.match(res.body.error, /sign in again/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://api.test/api/auth/me");
});

test("GET /customers with a valid token returns the customers", async () => {
  const { call, calls } = await serverWith(
    { body: { user: sarah } },
    asOwner,
    { body: { data: [{ id: "c1", name: "Dana Whitfield" }] } },
  );

  const res = await call("/customers", { token: "user-token" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, [{ id: "c1", name: "Dana Whitfield" }]);
  // Who is asking: the user's token. Reading the data: the server's secret key.
  assert.equal(calls[0].headers.Authorization, "Bearer user-token");
  assert.equal(calls[1].url, "http://api.test/api/permissions/me");
  assert.equal(calls[1].headers.Authorization, "Bearer user-token");
  assert.equal(calls[2].headers.Authorization, "Bearer sk_test_1");
  assert.match(calls[2].url, /\/api\/modules\/data\/customers\/records/);
});

test("a signed-in user with no role is refused: signing in is not permission", async () => {
  const { call, calls } = await serverWith({ body: { user: marcus } }, noRole);

  const res = await call("/customers", { token: "user-token" });

  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Your role does not allow this.", required_permission: "data.records.read" });
  assert.equal(calls.length, 2, "no customers were read");
});

test("staff can read the customers", async () => {
  const { call } = await serverWith({ body: { user: marcus } }, asStaff, { body: { data: [{ id: CUSTOMER_ID }] } });

  assert.equal((await call("/customers", { token: "user-token" })).status, 200);
});

test("staff cannot delete a customer, and nothing is deleted", async () => {
  const { call, calls } = await serverWith({ body: { user: marcus } }, asStaff);

  const res = await call(`/customers/${CUSTOMER_ID}`, { method: "DELETE", token: "user-token" });

  assert.equal(res.status, 403);
  assert.equal(res.body.required_permission, "data.records.delete");
  assert.ok(calls.every((c) => c.method !== "DELETE"), "HyphaBase was never asked to delete");
});

test("the owner can delete a customer", async () => {
  const { call, calls } = await serverWith({ body: { user: sarah } }, asOwner, { status: 204 });

  const res = await call(`/customers/${CUSTOMER_ID}`, { method: "DELETE", token: "user-token" });

  assert.equal(res.status, 204);
  assert.equal(calls[2].method, "DELETE");
  assert.equal(calls[2].url, `http://api.test/api/modules/data/customers/records/${CUSTOMER_ID}`);
  assert.equal(calls[2].headers.Authorization, "Bearer sk_test_1");
});

test("DELETE /customers/:id without a token is a 401, before any permission check", async () => {
  const { call, calls } = await serverWith();

  assert.equal((await call(`/customers/${CUSTOMER_ID}`, { method: "DELETE" })).status, 401);
  assert.equal(calls.length, 0);
});

test("deleting a customer that does not exist is a 404", async () => {
  const { call } = await serverWith({ body: { user: sarah } }, asOwner, { status: 404, body: { message: "No customers record with id x." } });

  const res = await call(`/customers/${CUSTOMER_ID}`, { method: "DELETE", token: "user-token" });

  assert.equal(res.status, 404);
  assert.equal(res.body.error, "No such customer.");
});

test("an id that is not a record id is a 404 without asking HyphaBase", async () => {
  const { call, calls } = await serverWith();

  assert.equal((await call("/customers/not-an-id", { method: "DELETE", token: "user-token" })).status, 404);
  assert.equal(calls.length, 0);
});

test("POST /login returns a token and the user, and keeps the refresh token on the server side", async () => {
  const { call, calls } = await serverWith({
    body: { token: "user-token", refresh_token: "refresh", expires_at: "2026-11-12T01:00:00+00:00", user: sarah, location_ids: ["loc-1"] },
  });

  const res = await call("/login", { method: "POST", body: { email: sarah.email, password: "a-long-passphrase" } });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { token: "user-token", expires_at: "2026-11-12T01:00:00+00:00", user: sarah });
  assert.deepEqual(calls[0].body, { email: sarah.email, password: "a-long-passphrase" });
});

test("POST /login with a wrong password is a 401 that does not say which part was wrong", async () => {
  const { call } = await serverWith({ status: 422, body: { message: "These credentials do not match our records." } });

  const res = await call("/login", { method: "POST", body: { email: sarah.email, password: "nope" } });

  assert.equal(res.status, 401);
  assert.equal(res.body.error, "Wrong email or password.");
});

test("POST /login without an email and password is a 400", async () => {
  const { call, calls } = await serverWith();

  assert.equal((await call("/login", { method: "POST", body: { email: sarah.email } })).status, 400);
  assert.equal(calls.length, 0);
});

test("GET /me returns the signed-in user and what they may do", async () => {
  const { call } = await serverWith({ body: { user: { ...sarah, phone: null, locations: [{ id: "loc-1" }] } } }, asStaff);

  const res = await call("/me", { token: "user-token" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.user, sarah);
  assert.deepEqual(res.body.permissions, ["data.records.read"]);
});

test("POST /logout revokes the token", async () => {
  const { call, calls } = await serverWith({ status: 204 });

  const res = await call("/logout", { method: "POST", token: "user-token" });

  assert.equal(res.status, 204);
  assert.equal(calls[0].url, "http://api.test/api/auth/logout");
  assert.equal(calls[0].headers.Authorization, "Bearer user-token");
});

test("a HyphaBase failure becomes a 502, without leaking details", async () => {
  const { call } = await serverWith({ body: { user: sarah } }, asOwner, { status: 403, body: { message: "This API key does not have the 'data.records.read' scope." } });

  const res = await call("/customers", { token: "user-token" });

  assert.equal(res.status, 502);
  assert.equal(res.body.error, "The CRM could not reach its backend.");
});

test("unknown routes are a 404", async () => {
  const { call } = await serverWith();

  assert.equal((await call("/nope")).status, 404);
});
