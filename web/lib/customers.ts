/**
 * What a customer is, for the server and the browser alike.
 *
 * The fields are the ones the Customers collection was created with in
 * episode 2 (src/customers.js). HyphaBase validates every record too; the
 * checks here are so a person gets one clear message per field, and so
 * nothing but these four fields is ever passed on.
 */

export const STATUSES = ["lead", "active", "inactive"] as const;
export type Status = (typeof STATUSES)[number];

/** The fields we define. HyphaBase adds `id` and the timestamps. */
export type CustomerFields = {
  name: string;
  email: string;
  phone: string | null;
  status: Status;
};

export type Customer = CustomerFields & { id: string };

export type CustomerInput = { name: string; email: string; phone?: string; status?: Status };
export type CustomerChanges = Partial<CustomerFields>;
export type CustomerErrors = Partial<Record<keyof CustomerFields, string>>;

/** A customer as the browser sees it: our fields and the id, nothing else HyphaBase stores. */
export function toCustomer(record: Customer): Customer {
  return { id: record.id, name: record.name, email: record.email, phone: record.phone ?? null, status: record.status };
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const fieldsOf = (input: unknown) => (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

// One check per field, shared by adding and editing so both give the same messages.
const check = {
  name(value: unknown, errors: CustomerErrors) {
    const name = text(value);
    if (!name) errors.name = "Enter a name.";
    else if (name.length > 200) errors.name = "Keep the name under 200 characters.";
    return name;
  },
  email(value: unknown, errors: CustomerErrors) {
    const email = text(value).toLowerCase();
    if (!email) errors.email = "Enter an email address.";
    else if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
    return email;
  },
  phone(value: unknown, errors: CustomerErrors) {
    const phone = text(value);
    if (phone.length > 50) errors.phone = "Keep the phone number under 50 characters.";
    return phone;
  },
  status(value: unknown, errors: CustomerErrors) {
    if (!STATUSES.includes(value as Status)) errors.status = "Choose lead, active or inactive.";
    return value as Status;
  },
};

export function parseCustomer(input: unknown): { ok: true; customer: CustomerInput } | { ok: false; errors: CustomerErrors } {
  const raw = fieldsOf(input);
  const errors: CustomerErrors = {};

  const name = check.name(raw.name, errors);
  const email = check.email(raw.email, errors);
  const phone = check.phone(raw.phone, errors);
  // Left out, the collection's own default applies (lead).
  const status = raw.status === undefined || raw.status === "" ? undefined : check.status(raw.status, errors);

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    customer: { name, email, ...(phone ? { phone } : {}), ...(status ? { status } : {}) },
  };
}

/**
 * An edit: any of the four fields, and only the ones that were sent. A
 * field that is left out keeps its value. An empty phone number means
 * "remove it", which HyphaBase spells null.
 */
export function parseCustomerChanges(input: unknown): { ok: true; changes: CustomerChanges } | { ok: false; errors: CustomerErrors } {
  const raw = fieldsOf(input);
  const errors: CustomerErrors = {};
  const changes: CustomerChanges = {};

  if (raw.name !== undefined) changes.name = check.name(raw.name, errors);
  if (raw.email !== undefined) changes.email = check.email(raw.email, errors);
  if (raw.phone !== undefined) changes.phone = check.phone(raw.phone, errors) || null;
  if (raw.status !== undefined) changes.status = check.status(raw.status, errors);

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, changes };
}
