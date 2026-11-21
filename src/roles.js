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
  updateCustomers: "data.records.update",
  deleteCustomers: "data.records.delete",
};

export const ROLES = {
  owner: { name: "Owner", permissions: [CAN.readCustomers, CAN.addCustomers, CAN.updateCustomers, CAN.deleteCustomers] },
  staff: { name: "Staff", permissions: [CAN.readCustomers, CAN.updateCustomers] },
};

const ROLES_PATH = "/api/modules/organizations/roles";

/**
 * Creates the role once; later runs find it by name. A role that is already
 * there gains any permission it is missing (episode 6 gave both roles one
 * more) and keeps whatever else it carries. Needs `roles.view`,
 * `roles.create` and, to add to an existing role, `roles.update`.
 */
export async function ensureRole(api, locationId, { name, permissions }) {
  const { data: roles } = await api.request(`${ROLES_PATH}?per_page=100`, { locationId });
  const existing = roles.find((role) => role.name === name);

  if (!existing) {
    const { data: role } = await api.request(ROLES_PATH, { method: "POST", locationId, body: { name, permissions } });
    return { created: true, updated: false, role };
  }

  const missing = permissions.filter((permission) => !existing.permissions.includes(permission));
  if (missing.length === 0) return { created: false, updated: false, role: existing };

  const { data: role } = await api.request(`${ROLES_PATH}/${existing.id}`, {
    method: "PATCH",
    locationId,
    body: { permissions: [...existing.permissions, ...missing] },
  });
  return { created: false, updated: true, role };
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
