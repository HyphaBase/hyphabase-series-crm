import assert from "node:assert/strict";
import { test } from "node:test";

import { addUser, currentUser, signIn, signOut } from "../src/auth.js";
import { ApiError, createApi } from "../src/hyphabase.js";
import { fakeFetch } from "./fake-fetch.js";

const apiWith = (...responses) => {
  const { fetch, calls } = fakeFetch(...responses);
  return { api: createApi({ url: "http://api.test", key: "sk_test_1", fetch }), calls };
};

const sarah = { name: "Sarah Mitchell", email: "sarah@brightsideclean.example", password: "a-long-passphrase" };

test("addUser creates the user at a location, with the secret key", async () => {
  const { api, calls } = apiWith({ status: 201, body: { data: { id: "u1", name: sarah.name, email: sarah.email } } });

  const user = await addUser(api, "loc-1", sarah);

  assert.equal(user.id, "u1");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "http://api.test/api/modules/employees/users");
  assert.equal(calls[0].headers.Authorization, "Bearer sk_test_1");
  assert.equal(calls[0].headers["X-Location-Id"], "loc-1");
  assert.deepEqual(calls[0].body, sarah);
});

test("signIn trades an email and password for a token", async () => {
  const session = { token: "user-token", expires_at: "2026-11-12T01:00:00+00:00", user: { id: "u1", name: sarah.name } };
  const { api, calls } = apiWith({ body: session });

  const result = await signIn(api, { email: sarah.email, password: sarah.password });

  assert.deepEqual(result, session);
  assert.equal(calls[0].url, "http://api.test/api/auth/login");
  // The key tells HyphaBase which app the user belongs to.
  assert.equal(calls[0].headers.Authorization, "Bearer sk_test_1");
  assert.deepEqual(calls[0].body, { email: sarah.email, password: sarah.password });
});

test("signIn passes a wrong password on as the API's error", async () => {
  const { api } = apiWith({ status: 422, body: { message: "These credentials do not match our records." } });

  await assert.rejects(signIn(api, { email: sarah.email, password: "nope" }), (error) => error instanceof ApiError && error.status === 422);
});

test("currentUser asks HyphaBase who a token belongs to", async () => {
  const { api, calls } = apiWith({ body: { user: { id: "u1", name: sarah.name, email: sarah.email } } });

  const user = await currentUser(api, "loc-1", "user-token");

  assert.equal(user.name, "Sarah Mitchell");
  assert.equal(calls[0].url, "http://api.test/api/auth/me");
  // The user's token, not the secret key.
  assert.equal(calls[0].headers.Authorization, "Bearer user-token");
  assert.equal(calls[0].headers["X-Location-Id"], "loc-1");
});

test("currentUser returns null for a token HyphaBase does not accept", async () => {
  const { api } = apiWith({ status: 401, body: { message: "Unauthenticated." } });

  assert.equal(await currentUser(api, "loc-1", "made-up"), null);
});

test("currentUser does not hide other failures", async () => {
  const { api } = apiWith({ status: 403, body: { message: "You do not have access to this location." } });

  await assert.rejects(currentUser(api, "loc-1", "user-token"), (error) => error.status === 403);
});

test("signOut revokes the user's token", async () => {
  const { api, calls } = apiWith({ status: 204 });

  await signOut(api, "loc-1", "user-token");

  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "http://api.test/api/auth/logout");
  assert.equal(calls[0].headers.Authorization, "Bearer user-token");
  assert.equal(calls[0].headers["X-Location-Id"], "loc-1");
});
