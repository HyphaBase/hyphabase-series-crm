import assert from "node:assert/strict";
import { test } from "node:test";

import { createApi } from "../src/hyphabase.js";
import { CAN, ensureRole, findUser, giveRole, permissionsOf, ROLES } from "../src/roles.js";
import { fakeFetch } from "./fake-fetch.js";

const apiWith = (...responses) => {
  const { fetch, calls } = fakeFetch(...responses);
  return { api: createApi({ url: "http://api.test", key: "sk_test_1", fetch }), calls };
};

test("staff can read and edit customers and nothing else; the owner can also add and delete", () => {
  assert.deepEqual(ROLES.staff.permissions, [CAN.readCustomers, CAN.updateCustomers]);
  assert.deepEqual(ROLES.owner.permissions, [CAN.readCustomers, CAN.addCustomers, CAN.updateCustomers, CAN.deleteCustomers]);
  assert.ok(!ROLES.staff.permissions.includes(CAN.deleteCustomers));
});

test("ensureRole creates a role that does not exist yet", async () => {
  const { api, calls } = apiWith({ body: { data: [] } }, { status: 201, body: { data: { id: "r1", ...ROLES.staff } } });

  const result = await ensureRole(api, "loc-1", ROLES.staff);

  assert.equal(result.created, true);
  assert.equal(result.role.id, "r1");
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].url, "http://api.test/api/modules/organizations/roles");
  assert.equal(calls[1].headers["X-Location-Id"], "loc-1");
  assert.deepEqual(calls[1].body, ROLES.staff);
});

test("ensureRole finds an existing role by name and does not create a second one", async () => {
  const { api, calls } = apiWith({ body: { data: [{ id: "r1", ...ROLES.staff }] } });

  const result = await ensureRole(api, "loc-1", ROLES.staff);

  assert.equal(result.created, false);
  assert.equal(result.updated, false);
  assert.equal(result.role.id, "r1");
  assert.equal(calls.length, 1);
});

test("ensureRole adds the permissions an existing role is missing, and keeps the ones it has", async () => {
  const fromEpisode4 = { id: "r1", name: "Staff", permissions: [CAN.readCustomers, "files.view"] };
  const permissions = [CAN.readCustomers, "files.view", CAN.updateCustomers];
  const { api, calls } = apiWith({ body: { data: [fromEpisode4] } }, { body: { data: { ...fromEpisode4, permissions } } });

  const result = await ensureRole(api, "loc-1", ROLES.staff);

  assert.equal(result.created, false);
  assert.equal(result.updated, true);
  assert.deepEqual(result.role.permissions, permissions);
  assert.equal(calls[1].method, "PATCH");
  assert.equal(calls[1].url, "http://api.test/api/modules/organizations/roles/r1");
  assert.equal(calls[1].headers["X-Location-Id"], "loc-1");
  assert.deepEqual(calls[1].body, { permissions });
});

test("findUser matches the whole email, not part of it", async () => {
  const marcus = { id: "u2", email: "marcus@brightsideclean.example" };
  const { api, calls } = apiWith({ body: { data: [{ id: "u9", email: "not-marcus@brightsideclean.example" }, marcus] } }, { body: { data: [] } });

  assert.deepEqual(await findUser(api, "loc-1", "Marcus@brightsideclean.example"), marcus);
  assert.match(calls[0].url, /\/api\/modules\/employees\/users\?search=Marcus%40brightsideclean\.example$/);
  assert.equal(await findUser(api, "loc-1", "nobody@brightsideclean.example"), null);
});

test("giveRole links a user and a role", async () => {
  const { api, calls } = apiWith({ status: 201, body: { data: { id: "ur1", user_id: "u2", role_id: "r1" } } });

  await giveRole(api, "loc-1", "u2", "r1");

  assert.equal(calls[0].url, "http://api.test/api/modules/employees/user-roles");
  assert.deepEqual(calls[0].body, { user_id: "u2", role_id: "r1" });
  assert.equal(calls[0].headers.Authorization, "Bearer sk_test_1");
});

test("permissionsOf asks with the user's token, not the secret key", async () => {
  const { api, calls } = apiWith({ body: { permissions: [CAN.readCustomers], roles_updated_at: null } });

  assert.deepEqual(await permissionsOf(api, "loc-1", "user-token"), [CAN.readCustomers]);
  assert.equal(calls[0].url, "http://api.test/api/permissions/me");
  assert.equal(calls[0].headers.Authorization, "Bearer user-token");
  assert.equal(calls[0].headers["X-Location-Id"], "loc-1");
});
