import assert from "node:assert/strict";
import { test } from "node:test";

import { addCustomer, CUSTOMERS, deleteCustomer, ensureCustomersCollection, getCustomer, listCustomers } from "../src/customers.js";
import { createApi } from "../src/hyphabase.js";
import { fakeFetch } from "./fake-fetch.js";

const apiWith = (...responses) => {
  const { fetch, calls } = fakeFetch(...responses);
  return { api: createApi({ url: "http://api.test", key: "sk_test_1", fetch }), calls };
};

test("the Customers collection has name, email, phone and status", () => {
  assert.equal(CUSTOMERS.slug, "customers");
  assert.deepEqual(CUSTOMERS.fields.map((f) => f.name), ["name", "email", "phone", "status"]);
});

test("ensureCustomersCollection creates the collection when it is missing", async () => {
  const { api, calls } = apiWith({ body: { data: [] } }, { status: 201, body: { data: { slug: "customers" } } });

  const result = await ensureCustomersCollection(api);

  assert.equal(result.created, true);
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].url, "http://api.test/api/modules/data/collections");
  assert.deepEqual(calls[1].body, CUSTOMERS);
});

test("ensureCustomersCollection leaves an existing collection alone", async () => {
  const { api, calls } = apiWith({ body: { data: [{ slug: "customers", fields: [] }] } });

  const result = await ensureCustomersCollection(api);

  assert.equal(result.created, false);
  assert.equal(calls.length, 1);
});

test("addCustomer posts a flat record to the customers collection", async () => {
  const customer = { name: "Dana Whitfield", email: "dana@example.com" };
  const { api, calls } = apiWith({ status: 201, body: { data: { id: "c1", ...customer, status: "lead" } } });

  const created = await addCustomer(api, customer);

  assert.equal(created.id, "c1");
  assert.equal(created.status, "lead");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "http://api.test/api/modules/data/customers/records");
  assert.deepEqual(calls[0].body, customer);
});

test("getCustomer reads one record by id", async () => {
  const { api, calls } = apiWith({ body: { data: { id: "c1", name: "Dana Whitfield" } } });

  assert.equal((await getCustomer(api, "c1")).name, "Dana Whitfield");
  assert.equal(calls[0].url, "http://api.test/api/modules/data/customers/records/c1");
});

test("listCustomers returns the records, newest first", async () => {
  const { api, calls } = apiWith({ body: { data: [{ id: "c1" }], meta: { next_cursor: null } } });

  assert.deepEqual(await listCustomers(api), [{ id: "c1" }]);
  assert.equal(calls[0].url, "http://api.test/api/modules/data/customers/records?sort=-created_at");
});

test("deleteCustomer deletes one record by id", async () => {
  const { api, calls } = apiWith({ status: 204 });

  await deleteCustomer(api, "c1");

  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url, "http://api.test/api/modules/data/customers/records/c1");
});
