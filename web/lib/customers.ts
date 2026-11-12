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
export type CustomerErrors = Partial<Record<keyof CustomerFields, string>>;

/** A customer as the browser sees it: our fields and the id, nothing else HyphaBase stores. */
export function toCustomer(record: Customer): Customer {
  return { id: record.id, name: record.name, email: record.email, phone: record.phone ?? null, status: record.status };
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function parseCustomer(input: unknown): { ok: true; customer: CustomerInput } | { ok: false; errors: CustomerErrors } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const errors: CustomerErrors = {};

  const name = text(raw.name);
  if (!name) errors.name = "Enter a name.";
  else if (name.length > 200) errors.name = "Keep the name under 200 characters.";

  const email = text(raw.email).toLowerCase();
  if (!email) errors.email = "Enter an email address.";
  else if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";

  const phone = text(raw.phone);
  if (phone.length > 50) errors.phone = "Keep the phone number under 50 characters.";

  // Left out, the collection's own default applies (lead).
  const status = raw.status === undefined || raw.status === "" ? undefined : raw.status;
  if (status !== undefined && !STATUSES.includes(status as Status)) errors.status = "Choose lead, active or inactive.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    customer: { name, email, ...(phone ? { phone } : {}), ...(status ? { status: status as Status } : {}) },
  };
}
