import assert from "node:assert/strict";
import { test } from "node:test";

import { CUSTOMERS } from "../src/customers.js";
import { createApi } from "../src/hyphabase.js";
import { SAMPLE_CUSTOMERS, seedCustomers } from "../src/seed.js";
import { fakeFetch } from "./fake-fetch.js";

const apiWith = (...responses) => {
  const { fetch, calls } = fakeFetch(...responses);
  return { api: createApi({ url: "http://api.test", key: "sk_test_1", fetch }), calls };
};

const RECORDS = "http://api.test/api/modules/data/customers/records";

test("the sample customers are 60 made-up people the collection would accept", () => {
  const statuses = CUSTOMERS.fields.find((field) => field.name === "status").values;

  assert.equal(SAMPLE_CUSTOMERS.length, 60);
  assert.equal(new Set(SAMPLE_CUSTOMERS.map((c) => c.email)).size, 60, "every email is different");
  for (const customer of SAMPLE_CUSTOMERS) {
    assert.deepEqual(Object.keys(customer), ["name", "email", "phone", "status"]);
    assert.match(customer.email, /^[a-z.]+@example\.com$/, "example.com belongs to nobody");
    assert.match(customer.phone, /^555-01\d\d$/, "555-01xx numbers are kept for fiction");
    assert.ok(statuses.includes(customer.status));
  }
  for (const status of statuses) assert.ok(SAMPLE_CUSTOMERS.some((c) => c.status === status), `some are ${status}`);
});

test("the sample customers leave the names the series already uses alone", () => {
  const taken = ["dana@example.com", "liam.ortiz@example.com", "priya@example.com"];

  assert.deepEqual(SAMPLE_CUSTOMERS.filter((c) => taken.includes(c.email)), []);
});

test("seedCustomers adds every sample customer in one request", async () => {
  const { api, calls } = apiWith({ body: { data: [], meta: { next_cursor: null } } }, { status: 201, body: { data: [] } });

  const result = await seedCustomers(api);

  assert.deepEqual(result, { added: 60, skipped: 0 });
  assert.equal(calls[0].url, `${RECORDS}?select=email&limit=100`);
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].url, `${RECORDS}/batch`);
  assert.deepEqual(calls[1].body, { records: SAMPLE_CUSTOMERS });
});

test("seedCustomers skips the ones that are already there, so it can be run twice", async () => {
  const [first, second, ...rest] = SAMPLE_CUSTOMERS;
  const { api, calls } = apiWith(
    { body: { data: [{ id: "c1", email: first.email }], meta: { next_cursor: "page-2" } } },
    { body: { data: [{ id: "c2", email: second.email }, { id: "c3", email: "dana@example.com" }], meta: { next_cursor: null } } },
    { status: 201, body: { data: [] } },
  );

  const result = await seedCustomers(api);

  assert.deepEqual(result, { added: 58, skipped: 2 });
  assert.equal(calls[1].url, `${RECORDS}?select=email&limit=100&cursor=page-2`, "it reads every page of the list");
  assert.deepEqual(calls[2].body, { records: rest });
});

test("seedCustomers writes nothing when everyone is already there", async () => {
  const { api, calls } = apiWith({ body: { data: SAMPLE_CUSTOMERS.map((c) => ({ email: c.email })), meta: { next_cursor: null } } });

  assert.deepEqual(await seedCustomers(api), { added: 0, skipped: 60 });
  assert.equal(calls.length, 1);
});

test("seedCustomers takes another list, in batches of at most 100", async () => {
  const many = Array.from({ length: 130 }, (_, n) => ({ name: `Test ${n}`, email: `test-${n}@example.com` }));
  const { api, calls } = apiWith({ body: { data: [], meta: { next_cursor: null } } }, { status: 201, body: { data: [] } }, { status: 201, body: { data: [] } });

  assert.deepEqual(await seedCustomers(api, many), { added: 130, skipped: 0 });
  assert.equal(calls[1].body.records.length, 100);
  assert.equal(calls[2].body.records.length, 30);
});
