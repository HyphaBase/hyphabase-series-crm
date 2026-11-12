/**
 * What each person may do in the CRM: roles and the permissions they carry.
 *
 * HyphaBase stores the roles, who has which one, and answers "what may this
 * user do?" for any signed-in user. The CRM server asks that question before
 * it touches customer data (src/server.js). There is no roles table here.
 */

/** The permission names are HyphaBase's own; a role cannot carry one that does not exist. */
export const CAN = {
  readCustomers: "data.records.read",
  addCustomers: "data.records.create",
  deleteCustomers: "data.records.delete",
};

export const ROLES = {
  owner: { name: "Owner", permissions: [CAN.readCustomers, CAN.addCustomers, CAN.deleteCustomers] },
  staff: { name: "Staff", permissions: [CAN.readCustomers] },
};

const ROLES_PATH = "/api/modules/organizations/roles";

/** Creates the role once; later runs find it by name and do nothing. Needs `roles.view` and `roles.create`. */
export async function ensureRole(api, locationId, { name, permissions }) {
  const { data: roles } = await api.request(`${ROLES_PATH}?per_page=100`, { locationId });
  const existing = roles.find((role) => role.name === name);
  if (existing) return { created: false, role: existing };

  const { data: role } = await api.request(ROLES_PATH, { method: "POST", locationId, body: { name, permissions } });
  return { created: true, role };
}

/** The user with exactly this email, or null. Needs the `users.view` scope. */
export async function findUser(api, locationId, email) {
  const { data: users } = await api.request(`/api/modules/employees/users?search=${encodeURIComponent(email)}`, { locationId });
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;
}

/** Gives a user a role. Needs the `roles.assign` scope. */
export async function giveRole(api, locationId, userId, roleId) {
  const { data } = await api.request("/api/modules/employees/user-roles", {
    method: "POST",
    locationId,
    body: { user_id: userId, role_id: roleId },
  });
  return data;
}

/** Everything the user behind a token may do: the permissions of all their roles. */
export async function permissionsOf(api, locationId, token) {
  const { permissions } = await api.request("/api/permissions/me", { token, locationId });
  return permissions;
}
