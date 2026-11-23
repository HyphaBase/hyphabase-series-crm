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

/** How many customers one request returns. The browser does not get to choose. */
export const PAGE_SIZE = 25;

/** What the list can be asked: part of a name, one status, or both. */
export type ListFilter = { q: string; status: Status | null };

/** A filter, and where to carry on from: the `next_cursor` of the page before. */
export type ListQuery = ListFilter & { cursor: string | null };

// HyphaBase's cursors are base64. Anything else was not handed out by it.
const CURSOR = /^[A-Za-z0-9+/=]{1,300}$/;

/**
 * Reads a question about the list out of whatever the browser sent. Only
 * three things are ever read: `q`, `status` and `cursor`. A search or a
 * status that makes no sense is left out, which shows the whole list. A
 * cursor that makes no sense is an error, because showing page one in
 * answer to "the next page" would repeat customers on the screen.
 */
export function parseListQuery(input: unknown): { ok: true; query: ListQuery } | { ok: false } {
  const raw = fieldsOf(input);

  const q = text(raw.q).slice(0, 100);
  const status = STATUSES.includes(raw.status as Status) ? (raw.status as Status) : null;

  if (raw.cursor === undefined || raw.cursor === null || raw.cursor === "") return { ok: true, query: { q, status, cursor: null } };
  if (typeof raw.cursor !== "string" || !CURSOR.test(raw.cursor)) return { ok: false };
  return { ok: true, query: { q, status, cursor: raw.cursor } };
}

/** A filter as a query string, for this app's own address bar and its own API: "?q=dana&status=active", or "" for everything. */
export function toSearch({ q, status, cursor }: ListFilter & { cursor?: string | null }): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  const search = params.toString();
  return search ? `?${search}` : "";
}

/** The filter in an address, so a reload or a bookmark shows the same list. */
export function readListQuery(search: string): ListFilter {
  const params = new URLSearchParams(search);
  const parsed = parseListQuery({ q: params.get("q"), status: params.get("status") });
  return parsed.ok ? { q: parsed.query.q, status: parsed.query.status } : { q: "", status: null };
}

/** The list with another page on the end. A customer added or edited meanwhile may already be on screen, and is not shown twice. */
export function addPage(shown: Customer[], page: Customer[]): Customer[] {
  const seen = new Set(shown.map((customer) => customer.id));
  return [...shown, ...page.filter((customer) => !seen.has(customer.id))];
}

/**
 * The line under the heading. HyphaBase returns a page and whether there
 * is another one, never a total, so a number is only called the number of
 * customers once the last page is on screen.
 */
export function describeList(shown: number, more: boolean, filter: ListFilter): string {
  const filtered = Boolean(filter.q || filter.status);
  if (more) return `Showing ${shown} ${filtered ? "matches" : "customers"}, newest first`;
  if (!filtered) return `${shown} ${shown === 1 ? "customer" : "customers"} in Portland`;
  if (shown === 0) return "No customers match";
  return shown === 1 ? "1 customer matches" : `${shown} customers match`;
}
