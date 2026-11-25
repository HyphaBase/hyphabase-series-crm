import assert from "node:assert/strict";
import { test } from "node:test";

import { CLIENT_STATUSES, ensureClientStatuses, moveCustomers, toClient } from "../src/clients.js";
import { createApi } from "../src/hyphabase.js";
import { fakeFetch } from "./fake-fetch.js";

const apiWith = (...responses) => {
  const { fetch, calls } = fakeFetch(...responses);
  return { api: createApi({ url: "http://api.test", key: "sk_test_1", fetch }), calls };
};

const CLIENTS = "http://api.test/api/modules/clients";
const RECORDS = "http://api.test/api/modules/data/customers/records";
const STATUS_IDS = { lead: "s-lead", active: "s-active", inactive: "s-inactive" };
const statusRows = [{ id: "s-lead", name: "Lead" }, { id: "s-active", name: "Active" }, { id: "s-inactive", name: "Inactive" }];

test("the client statuses are the three the collection had", () => {
  assert.deepEqual(CLIENT_STATUSES, ["Lead", "Active", "Inactive"]);
});

test("ensureClientStatuses creates the ones that are missing and returns an id for each", async () => {
  const { api, calls } = apiWith(
    { body: { data: [{ id: "s-active", name: "Active" }] } },
    { status: 201, body: { data: { id: "s-lead", name: "Lead" } } },
    { status: 201, body: { data: { id: "s-inactive", name: "Inactive" } } },
  );

  const result = await ensureClientStatuses(api, "loc-1");

  assert.deepEqual(result, { created: ["Lead", "Inactive"], ids: STATUS_IDS });
  assert.equal(calls[0].url, `${CLIENTS}/client-statuses`);
  assert.equal(calls[0].headers["X-Location-Id"], "loc-1");
  assert.deepEqual(calls.slice(1).map((call) => [call.method, call.url, call.body]), [
    ["POST", `${CLIENTS}/client-statuses`, { name: "Lead", sort_order: 1 }],
    ["POST", `${CLIENTS}/client-statuses`, { name: "Inactive", sort_order: 3 }],
  ]);
});

test("ensureClientStatuses writes nothing when all three are there, so it can be run twice", async () => {
  const { api, calls } = apiWith({ body: { data: statusRows } });

  assert.deepEqual(await ensureClientStatuses(api, "loc-1"), { created: [], ids: STATUS_IDS });
  assert.equal(calls.length, 1);
});

test("toClient splits the name at the first space and keeps the rest together", () => {
  const record = { name: "Dana Whitfield", email: "dana@example.com", phone: "555-0142", status: "lead" };

  assert.deepEqual(toClient(record), { ok: true, client: { first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", phone: "555-0142" } });
  assert.equal(toClient({ ...record, name: "  Ana  de la Cruz " }).client.last_name, "de la Cruz");
});

test("toClient says why a customer cannot be a client: the module wants a last name and a phone number", () => {
  assert.deepEqual(toClient({ name: "Cher", email: "cher@example.com", phone: "555-0100" }), { ok: false, reason: "has no last name" });
  assert.deepEqual(toClient({ name: "Dana Whitfield", email: "dana@example.com", phone: null }), { ok: false, reason: "has no phone number" });
});

test("moveCustomers copies every customer into the Clients module with its status", async () => {
  const { api, calls } = apiWith(
    { body: { data: statusRows } },
    { body: { data: [{ id: "r1", name: "Dana Whitfield", email: "dana@example.com", phone: "555-0142", status: "lead" }], meta: { next_cursor: "page-2" } } },
    { body: { data: [{ id: "r2", name: "Liam Ortiz", email: "liam.ortiz@example.com", phone: "555-0117", status: "active" }], meta: { next_cursor: null } } },
    { status: 201, body: { data: { id: "c1" } } },
    { status: 201, body: { data: {} } },
    { status: 201, body: { data: { id: "c2" } } },
    { status: 201, body: { data: {} } },
  );

  const result = await moveCustomers(api, "loc-1");

  assert.deepEqual(result, { moved: 2, already: 0, skipped: [] });
  assert.equal(calls[1].url, `${RECORDS}?limit=100`);
  assert.equal(calls[2].url, `${RECORDS}?limit=100&cursor=page-2`, "it reads every page of the collection");
  assert.deepEqual([calls[3].method, calls[3].url, calls[3].body], ["POST", CLIENTS, { first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", phone: "555-0142" }]);
  assert.deepEqual([calls[4].method, calls[4].url, calls[4].body], ["POST", `${CLIENTS}/c1/statuses`, { location_id: "loc-1", client_status_id: "s-lead" }]);
  assert.deepEqual(calls[6].body, { location_id: "loc-1", client_status_id: "s-active" });
  assert.ok(calls.slice(3).every((call) => call.headers["X-Location-Id"] === "loc-1"));
  assert.ok(!calls.some((call) => call.method === "DELETE"), "the collection is left as it was");
});

test("moveCustomers leaves a client that is already there alone, so it can be run twice", async () => {
  const taken = { message: "A client with this email already exists (id c1).", errors: { email: ["A client with this email already exists (id c1)."] } };
  const { api, calls } = apiWith(
    { body: { data: statusRows } },
    { body: { data: [{ id: "r1", name: "Dana Whitfield", email: "dana@example.com", phone: "555-0142", status: "lead" }], meta: { next_cursor: null } } },
    { status: 422, body: taken },
  );

  assert.deepEqual(await moveCustomers(api, "loc-1"), { moved: 0, already: 1, skipped: [] });
  assert.equal(calls.length, 3);
});

test("moveCustomers reports the customers it could not move, and carries on", async () => {
  const { api } = apiWith(
    { body: { data: statusRows } },
    { body: { data: [
      { id: "r1", name: "Cher", email: "cher@example.com", phone: "555-0100", status: "lead" },
      { id: "r2", name: "Liam Ortiz", email: "liam.ortiz@example.com", phone: "555-0117", status: "active" },
    ], meta: { next_cursor: null } } },
    { status: 201, body: { data: { id: "c2" } } },
    { status: 201, body: { data: {} } },
  );

  assert.deepEqual(await moveCustomers(api, "loc-1"), { moved: 1, already: 0, skipped: [{ email: "cher@example.com", reason: "has no last name" }] });
});

test("moveCustomers stops on a refusal it does not understand", async () => {
  const { api } = apiWith(
    { body: { data: statusRows } },
    { body: { data: [{ id: "r1", name: "Dana Whitfield", email: "dana@example.com", phone: "555-0142", status: "lead" }], meta: { next_cursor: null } } },
    { status: 403, body: { message: "This API key is missing the 'clients.create' scope." } },
  );

  await assert.rejects(moveCustomers(api, "loc-1"), /clients\.create/);
});
