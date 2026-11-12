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
    { body: { data: [{ id: "c1", name: "Dana Whitfield" }] } },
  );

  const res = await call("/customers", { token: "user-token" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, [{ id: "c1", name: "Dana Whitfield" }]);
  // Who is asking: the user's token. Reading the data: the server's secret key.
  assert.equal(calls[0].headers.Authorization, "Bearer user-token");
  assert.equal(calls[1].headers.Authorization, "Bearer sk_test_1");
  assert.match(calls[1].url, /\/api\/modules\/data\/customers\/records/);
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

test("GET /me returns the signed-in user", async () => {
  const { call } = await serverWith({ body: { user: { ...sarah, phone: null, locations: [{ id: "loc-1" }] } } });

  const res = await call("/me", { token: "user-token" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.user, sarah);
});

test("POST /logout revokes the token", async () => {
  const { call, calls } = await serverWith({ status: 204 });

  const res = await call("/logout", { method: "POST", token: "user-token" });

  assert.equal(res.status, 204);
  assert.equal(calls[0].url, "http://api.test/api/auth/logout");
  assert.equal(calls[0].headers.Authorization, "Bearer user-token");
});

test("a HyphaBase failure becomes a 502, without leaking details", async () => {
  const { call } = await serverWith({ body: { user: sarah } }, { status: 403, body: { message: "This API key does not have the 'data.records.read' scope." } });

  const res = await call("/customers", { token: "user-token" });

  assert.equal(res.status, 502);
  assert.equal(res.body.error, "The CRM could not reach its backend.");
});

test("unknown routes are a 404", async () => {
  const { call } = await serverWith();

  assert.equal((await call("/nope")).status, 404);
});
