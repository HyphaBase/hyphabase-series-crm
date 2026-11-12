/**
 * End-to-end check of episode 3 against a real HyphaBase environment, using .env:
 *
 *   npm run smoke
 *
 * Creates a throwaway user, starts the CRM server on a free port and proves
 * the claims the episode makes: no token, a made-up token, a wrong password
 * and a signed-out token are all refused; a signed-in user gets the customers.
 * The throwaway user is deleted afterwards if the key has users.delete;
 * this episode's key does not need that scope, so without it the user stays.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { addUser } from "../src/auth.js";
import { ensureCustomersCollection } from "../src/customers.js";
import { ApiError, createApi, loadConfig, requireLocation } from "../src/hyphabase.js";
import { createApp } from "../src/server.js";
import { createClient } from "../src/session.js";

const config = loadConfig();
const api = createApi(config);
const locationId = requireLocation(config);

const server = createServer(createApp({ api, locationId }));
after(() => server.close());

const refusedWith = (status) => (error) => error.status === status;

test("episode 3: only a signed-in user can read the customers", async () => {
  await ensureCustomersCollection(api);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const crm = createClient({ url: `http://127.0.0.1:${server.address().port}` });

  const credentials = { email: `smoke-${Date.now().toString(36)}@brightsideclean.example`, password: `Smoke-${crypto.randomUUID()}` };
  const user = await addUser(api, locationId, { name: "Smoke Test", ...credentials });

  await assert.rejects(crm.request("/customers"), refusedWith(401), "no token");
  await assert.rejects(crm.request("/customers", { token: "made-up-token" }), refusedWith(401), "a made-up token");
  await assert.rejects(crm.request("/login", { method: "POST", body: { ...credentials, password: "wrong" } }), refusedWith(401), "a wrong password");

  const session = await crm.request("/login", { method: "POST", body: credentials });
  assert.equal(session.user.email, credentials.email);
  assert.equal(session.refresh_token, undefined, "the refresh token is not handed out");

  const { data: customers } = await crm.request("/customers", { token: session.token });
  assert.ok(Array.isArray(customers));

  assert.equal((await crm.request("/me", { token: session.token })).user.id, user.id);

  // HyphaBase itself refuses a user's token on the data API: customers are only reachable through the server.
  await assert.rejects(api.request("/api/modules/data/customers/records", { token: session.token }), refusedWith(403));

  await crm.request("/logout", { method: "POST", token: session.token });
  await assert.rejects(crm.request("/customers", { token: session.token }), refusedWith(401), "a signed-out token");

  try {
    await api.request(`/api/modules/employees/users/${user.id}`, { method: "DELETE", locationId });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 403)) throw error;
    console.log(`Left user ${credentials.email} in place: the key has no users.delete scope.`);
  }
});
