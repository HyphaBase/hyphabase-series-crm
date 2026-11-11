/**
 * The CRM's first piece of data: a Customers collection.
 *
 * A collection is a real table in a database that belongs to your
 * environment. You describe the fields; HyphaBase creates the table and
 * gives you a REST API for its records.
 */

export const CUSTOMERS = {
  slug: "customers",
  name: "Customers",
  fields: [
    { name: "name", type: "string", required: true, max_length: 200 },
    { name: "email", type: "string", required: true, unique: true },
    { name: "phone", type: "string", max_length: 50 },
    { name: "status", type: "enum", required: true, values: ["lead", "active", "inactive"], default: "lead", indexed: true },
  ],
};

const COLLECTIONS = "/api/modules/data/collections";
const RECORDS = `/api/modules/data/${CUSTOMERS.slug}/records`;

/** Defines the collection once; later runs find it and do nothing. */
export async function ensureCustomersCollection(api) {
  const { data: collections } = await api.request(COLLECTIONS);
  const existing = collections.find((collection) => collection.slug === CUSTOMERS.slug);
  if (existing) return { created: false, collection: existing };

  const { data: collection } = await api.request(COLLECTIONS, { method: "POST", body: CUSTOMERS });
  return { created: true, collection };
}

export async function addCustomer(api, customer) {
  const { data } = await api.request(RECORDS, { method: "POST", body: customer });
  return data;
}

export async function getCustomer(api, id) {
  const { data } = await api.request(`${RECORDS}/${encodeURIComponent(id)}`);
  return data;
}

export async function listCustomers(api) {
  const { data } = await api.request(`${RECORDS}?sort=-created_at`);
  return data;
}
