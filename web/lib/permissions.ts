/** The permission names are HyphaBase's own, the same ones the roles carry (src/roles.js). */
export const CAN = {
  readCustomers: "data.records.read",
  addCustomers: "data.records.create",
  updateCustomers: "data.records.update",
  deleteCustomers: "data.records.delete",
} as const;

export type Permission = (typeof CAN)[keyof typeof CAN];
