import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError, createApi, describeError, loadConfig, requireLocation } from "../src/hyphabase.js";
import { fakeFetch } from "./fake-fetch.js";

test("loadConfig names the missing variable", () => {
  assert.throws(() => loadConfig({ HYPHABASE_API_URL: "http://x" }), /HYPHABASE_SECRET_KEY/);
  assert.throws(() => loadConfig({ HYPHABASE_SECRET_KEY: "sk_test_1" }), /HYPHABASE_API_URL/);
});

test("loadConfig refuses a key that is not a secret key", () => {
  assert.throws(() => loadConfig({ HYPHABASE_API_URL: "http://x", HYPHABASE_SECRET_KEY: "pk_test_1" }), /secret \(sk_\) key/);
});

test("loadConfig refuses the placeholder from .env.example", () => {
  assert.throws(() => loadConfig({ HYPHABASE_API_URL: "http://x", HYPHABASE_SECRET_KEY: "sk_test_..." }), /\.env/);
});

test("request sends the key as a bearer token and JSON-encodes the body", async () => {
  const { fetch, calls } = fakeFetch({ status: 201, body: { data: { id: "1" } } });
  const api = createApi({ url: "http://api.test/", key: "sk_test_1", fetch });

  const result = await api.request("/api/modules/data/collections", { method: "POST", body: { slug: "customers" } });

  assert.deepEqual(result, { data: { id: "1" } });
  assert.equal(calls[0].url, "http://api.test/api/modules/data/collections");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer sk_test_1");
  assert.equal(calls[0].headers["Content-Type"], "application/json");
  assert.deepEqual(calls[0].body, { slug: "customers" });
});

test("request throws an ApiError carrying the status and the API's message", async () => {
  const { fetch } = fakeFetch({ status: 404, body: { message: "No collection named 'customers'." } });
  const api = createApi({ url: "http://api.test", key: "sk_test_1", fetch });

  await assert.rejects(api.request("/api/modules/data/customers/records"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
    assert.equal(error.message, "No collection named 'customers'.");
    return true;
  });
});

test("describeError lists each field of a validation error", () => {
  const error = new ApiError(422, { message: "Invalid.", errors: { email: ["The email has already been taken."] } });
  assert.match(describeError(error), /email: The email has already been taken\./);
});

test("describeError explains a rejected key and a missing scope", () => {
  assert.match(describeError(new ApiError(401, { message: "Invalid, expired, or revoked API key." })), /HYPHABASE_SECRET_KEY/);
  assert.match(describeError(new ApiError(403, { message: "Forbidden." })), /scope/);
});

test("describeError explains an unreachable API", () => {
  const error = new TypeError("fetch failed");
  assert.match(describeError(error), /HYPHABASE_API_URL/);
});

test("loadConfig reads the optional location id", () => {
  const env = { HYPHABASE_API_URL: "http://x", HYPHABASE_SECRET_KEY: "sk_test_1" };
  assert.equal(loadConfig(env).locationId, undefined);
  assert.equal(loadConfig({ ...env, HYPHABASE_LOCATION_ID: "loc-1" }).locationId, "loc-1");
});

test("requireLocation names the missing variable", () => {
  assert.throws(() => requireLocation({}), /HYPHABASE_LOCATION_ID/);
  assert.equal(requireLocation({ locationId: "loc-1" }), "loc-1");
});

test("request can act as a user at a location instead of as the secret key", async () => {
  const { fetch, calls } = fakeFetch({ body: { user: {} } });
  const api = createApi({ url: "http://api.test", key: "sk_test_1", fetch });

  await api.request("/api/auth/me", { token: "user-token", locationId: "loc-1" });

  assert.equal(calls[0].headers.Authorization, "Bearer user-token");
  assert.equal(calls[0].headers["X-Location-Id"], "loc-1");
});
