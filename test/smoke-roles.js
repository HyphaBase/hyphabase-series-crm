/**
 * End-to-end check of episode 4 against a real HyphaBase environment, using .env:
 *
 *   npm run smoke
 *
 * Creates two throwaway users and a throwaway customer, starts the CRM server
 * on a free port and proves the claims the episode makes: a signed-in user
 * with no role gets nothing; staff can read but not delete, and the customer
 * survives the attempt; the owner can delete; and a user cannot create a role
 * or give themselves one. The throwaway users are deleted afterwards if the
 * key has users.delete (see test/smoke-auth.js).
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { addUser } from "../src/auth.js";
import { addCustomer, ensureCustomersCollection, getCustomer } from "../src/customers.js";
import { ApiError, createApi, loadConfig, requireLocation } from "../src/hyphabase.js";
import { CAN, ensureRole, giveRole, ROLES } from "../src/roles.js";
import { createApp } from "../src/server.js";
import { createClient } from "../src/session.js";

const config = loadConfig();
const api = createApi(config);
const locationId = requireLocation(config);

const server = createServer(createApp({ api, locationId }));
after(() => server.close());

const refusedWith = (status) => (error) => error.status === status;

test("episode 4: a role decides what a signed-in user can do", async () => {
  await ensureCustomersCollection(api);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const crm = createClient({ url: `http://127.0.0.1:${server.address().port}` });

  const run = Date.now().toString(36);
  const password = `Smoke-${crypto.randomUUID()}`;
  const signInAs = async (name) => {
    const email = `smoke-${name}-${run}@brightsideclean.example`;
    const user = await addUser(api, locationId, { name: `Smoke ${name}`, email, password });
    const { token } = await crm.request("/login", { method: "POST", body: { email, password } });
    return { user, token };
  };

  const owner = await signInAs("owner");
  const staff = await signInAs("staff");
  const customer = await addCustomer(api, { name: "Smoke Test", email: `smoke-${run}@example.com` });

  // Signed in, no role: nothing is allowed.
  assert.deepEqual((await crm.request("/me", { token: staff.token })).permissions, []);
  await assert.rejects(crm.request("/customers", { token: staff.token }), refusedWith(403), "no role, no customers");

  const { role: ownerRole } = await ensureRole(api, locationId, ROLES.owner);
  const { role: staffRole } = await ensureRole(api, locationId, ROLES.staff);
  await giveRole(api, locationId, owner.user.id, ownerRole.id);
  await giveRole(api, locationId, staff.user.id, staffRole.id);

  // Staff: the same token now reads (and, from episode 6, edits), and still cannot delete.
  assert.deepEqual((await crm.request("/me", { token: staff.token })).permissions, ROLES.staff.permissions);
  const { data: customers } = await crm.request("/customers", { token: staff.token });
  assert.ok(customers.some((c) => c.id === customer.id));
  await assert.rejects(crm.request(`/customers/${customer.id}`, { method: "DELETE", token: staff.token }), refusedWith(403), "staff cannot delete");
  assert.equal((await getCustomer(api, customer.id)).id, customer.id, "the customer survived the attempt");

  // A user cannot promote themselves: HyphaBase refuses, whatever our server does.
  const direct = { token: staff.token, locationId, method: "POST" };
  await assert.rejects(api.request("/api/modules/employees/user-roles", { ...direct, body: { user_id: staff.user.id, role_id: ownerRole.id } }), refusedWith(403));
  await assert.rejects(api.request("/api/modules/organizations/roles", { ...direct, body: { name: "Sneaky", permissions: [CAN.deleteCustomers] } }), refusedWith(403));

  // Owner: deletes, and the customer is gone.
  await crm.request(`/customers/${customer.id}`, { method: "DELETE", token: owner.token });
  await assert.rejects(getCustomer(api, customer.id), refusedWith(404));
  await assert.rejects(crm.request(`/customers/${customer.id}`, { method: "DELETE", token: owner.token }), refusedWith(404), "deleting twice");

  for (const { user, token } of [owner, staff]) {
    await crm.request("/logout", { method: "POST", token });
    try {
      await api.request(`/api/modules/employees/users/${user.id}`, { method: "DELETE", locationId });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 403)) throw error;
      console.log(`Left user ${user.email} in place: the key has no users.delete scope.`);
    }
  }
});
