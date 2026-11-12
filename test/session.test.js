import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { clearSession, createClient, loadSession, saveSession } from "../src/session.js";
import { fakeFetch } from "./fake-fetch.js";

test("a session is saved to a file only its owner can read, loaded, then cleared", () => {
  const file = join(mkdtempSync(join(tmpdir(), "crm-session-")), ".session");

  assert.equal(loadSession(file), null);

  saveSession(file, { token: "user-token", user: { name: "Sarah Mitchell" } });
  assert.equal(loadSession(file).token, "user-token");
  assert.equal(statSync(file).mode & 0o777, 0o600);

  clearSession(file);
  assert.equal(loadSession(file), null);
  clearSession(file); // clearing twice is fine
});

test("the client sends the saved token to the CRM server", async () => {
  const { fetch, calls } = fakeFetch({ body: { data: [] } });
  const client = createClient({ url: "http://crm.test/", fetch });

  await client.request("/customers", { token: "user-token" });

  assert.equal(calls[0].url, "http://crm.test/customers");
  assert.equal(calls[0].headers.Authorization, "Bearer user-token");
});

test("the client sends no Authorization header when there is no session", async () => {
  const { fetch, calls } = fakeFetch({ status: 401, body: { error: "Sign in first." } });
  const client = createClient({ url: "http://crm.test", fetch });

  await assert.rejects(client.request("/customers"), (error) => error.status === 401 && error.message === "Sign in first.");
  assert.equal(calls[0].headers.Authorization, undefined);
});
