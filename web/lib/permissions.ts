/**
 * The permission names are HyphaBase's own, the same ones the roles carry
 * (src/roles.js). Since episode 8 the customers live in the Clients
 * module, so these are the module's permissions. Adding a note to a
 * customer counts as updating that customer.
 */
export const CAN = {
  readCustomers: "clients.view",
  addCustomers: "clients.create",
  updateCustomers: "clients.update",
  deleteCustomers: "clients.delete",
} as const;

export type Permission = (typeof CAN)[keyof typeof CAN];
