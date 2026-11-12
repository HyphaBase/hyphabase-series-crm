/**
 * End-to-end check against a real HyphaBase environment, using .env:
 *
 *   npm run smoke
 *
 * Defines the collection if needed, creates a customer, reads it back and
 * finds it in the list. It then deletes its "Smoke Test" customer if the key
 * has data.records.delete (it does from episode 4); an older key lacks it, so
 * without it the record stays.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { addCustomer, CUSTOMERS, ensureCustomersCollection, getCustomer, listCustomers } from "../src/customers.js";
import { ApiError, createApi, loadConfig } from "../src/hyphabase.js";

const api = createApi(loadConfig());
const email = `smoke-${Date.now().toString(36)}@example.com`;

test("episode 2: define Customers, create one, read it back", async () => {
  const { collection } = await ensureCustomersCollection(api);
  assert.deepEqual(collection.fields.map((f) => f.name), CUSTOMERS.fields.map((f) => f.name));

  const created = await addCustomer(api, { name: "Smoke Test", email });
  assert.equal(created.status, "lead", "the default status applies");

  const fetched = await getCustomer(api, created.id);
  assert.equal(fetched.email, email);

  const listed = await listCustomers(api);
  assert.ok(listed.some((customer) => customer.id === created.id));

  await assert.rejects(addCustomer(api, { name: "Smoke Test", email }), (error) => error instanceof ApiError && error.status === 422);

  try {
    await api.request(`/api/modules/data/${CUSTOMERS.slug}/records/${created.id}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 403)) throw error;
    console.log(`Left customer ${created.id} (${email}) in place: the key has no data.records.delete scope.`);
  }
});
