/**
 * What a customer is, for the server and the browser alike.
 *
 * Since episode 8 a customer is a client in HyphaBase's Clients module:
 * a first and a last name, an email, a phone number and a status. The
 * module validates every client too; the checks here are so a person gets
 * one clear message per field, and so nothing but these fields is ever
 * passed on.
 */

export const STATUSES = ["lead", "active", "inactive"] as const;
export type Status = (typeof STATUSES)[number];

/** What the Clients module stores about a person. It asks for all four. */
export type ClientFields = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
};

/** The fields a person fills in. The status is kept beside the client, one per location. */
export type CustomerFields = ClientFields & { status: Status };

/** `name` is the two names together, put there by HyphaBase. */
export type Customer = CustomerFields & { id: string; name: string };

export type CustomerInput = ClientFields & { status?: Status };
export type CustomerChanges = Partial<CustomerFields>;
export type CustomerErrors = Partial<Record<keyof CustomerFields, string>>;

/** A note on a customer: what was written, by whom and when. HyphaBase fills in the last two. */
export type Note = { id: string; content: string; author: string | null; created_at: string };

/** The longest note the CRM accepts. */
export const NOTE_LENGTH = 2000;

/** A client as the Clients module returns one, as far as the CRM reads it. */
export type ClientRecord = ClientFields & {
  id: string;
  name: string;
  location_statuses?: { location_id: string; status?: { name?: string } | null }[];
};

/**
 * A customer as the browser sees it: our fields and the id, nothing else
 * HyphaBase stores. A client has one status per location; ours is the one
 * at `locationId`. A client nobody gave a status yet is shown as a lead.
 */
export function toCustomer(client: ClientRecord, locationId: string): Customer {
  const here = client.location_statuses?.find((entry) => entry.location_id === locationId);
  const status = here?.status?.name?.toLowerCase() as Status;
  return {
    id: client.id,
    first_name: client.first_name,
    last_name: client.last_name,
    name: client.name,
    email: client.email,
    phone: client.phone,
    status: STATUSES.includes(status) ? status : "lead",
  };
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const fieldsOf = (input: unknown) => (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

const nameCheck = (field: "first_name" | "last_name", label: string) => (value: unknown, errors: CustomerErrors) => {
  const name = text(value);
  if (!name) errors[field] = `Enter a ${label}.`;
  else if (name.length > 100) errors[field] = `Keep the ${label} under 100 characters.`;
  return name;
};

// One check per field, shared by adding and editing so both give the same messages.
const check = {
  first_name: nameCheck("first_name", "first name"),
  last_name: nameCheck("last_name", "last name"),
  email(value: unknown, errors: CustomerErrors) {
    const email = text(value).toLowerCase();
    if (!email) errors.email = "Enter an email address.";
    else if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
    return email;
  },
  phone(value: unknown, errors: CustomerErrors) {
    const phone = text(value);
    if (!phone) errors.phone = "Enter a phone number.";
    else if (phone.length > 50) errors.phone = "Keep the phone number under 50 characters.";
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

  const first_name = check.first_name(raw.first_name, errors);
  const last_name = check.last_name(raw.last_name, errors);
  const email = check.email(raw.email, errors);
  const phone = check.phone(raw.phone, errors);
  // Left out, a new customer starts as a lead.
  const status = raw.status === undefined || raw.status === "" ? undefined : check.status(raw.status, errors);

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, customer: { first_name, last_name, email, phone, ...(status ? { status } : {}) } };
}

/**
 * An edit: any of the five fields, and only the ones that were sent. A
 * field that is left out keeps its value. None of them can be emptied:
 * the Clients module wants a client to have all four, and a status.
 */
export function parseCustomerChanges(input: unknown): { ok: true; changes: CustomerChanges } | { ok: false; errors: CustomerErrors } {
  const raw = fieldsOf(input);
  const errors: CustomerErrors = {};
  const changes: CustomerChanges = {};

  if (raw.first_name !== undefined) changes.first_name = check.first_name(raw.first_name, errors);
  if (raw.last_name !== undefined) changes.last_name = check.last_name(raw.last_name, errors);
  if (raw.email !== undefined) changes.email = check.email(raw.email, errors);
  if (raw.phone !== undefined) changes.phone = check.phone(raw.phone, errors);
  if (raw.status !== undefined) changes.status = check.status(raw.status, errors);

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, changes };
}

/** A note's text, tidied. The author, the time and who can see it are not the browser's to choose. */
export function parseNote(input: unknown): { ok: true; content: string } | { ok: false; error: string } {
  const content = text(fieldsOf(input).content);
  if (!content) return { ok: false, error: "Write the note first." };
  if (content.length > NOTE_LENGTH) return { ok: false, error: "Keep the note under 2,000 characters." };
  return { ok: true, content };
}

/** How many customers one request returns. The browser does not get to choose. */
export const PAGE_SIZE = 25;

/** What the list can be asked: part of a name, an email or a phone number, one status, or both. */
export type ListFilter = { q: string; status: Status | null };

/** A filter, and which page of it: the `next_page` of the page before. */
export type ListQuery = ListFilter & { page: number };

// A page number, and not an absurd one.
const PAGE = /^[1-9]\d{0,3}$/;

/**
 * Reads a question about the list out of whatever the browser sent. Only
 * three things are ever read: `q`, `status` and `page`. A search or a
 * status that makes no sense is left out, which shows the whole list. A
 * page that makes no sense is an error, because showing page one in
 * answer to "the next page" would repeat customers on the screen.
 */
export function parseListQuery(input: unknown): { ok: true; query: ListQuery } | { ok: false } {
  const raw = fieldsOf(input);

  const q = text(raw.q).slice(0, 100);
  const status = STATUSES.includes(raw.status as Status) ? (raw.status as Status) : null;

  if (raw.page === undefined || raw.page === null || raw.page === "") return { ok: true, query: { q, status, page: 1 } };
  if ((typeof raw.page !== "string" && typeof raw.page !== "number") || !PAGE.test(String(raw.page))) return { ok: false };
  return { ok: true, query: { q, status, page: Number(raw.page) } };
}

/** A filter as a query string, for this app's own address bar and its own API: "?q=dana&status=active", or "" for everything. */
export function toSearch({ q, status, page }: ListFilter & { page?: number | null }): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (status) params.set("status", status);
  if (page) params.set("page", String(page));
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
 * The line under the heading. The Clients module returns a total with
 * every page, so the line can say how many there are before the last
 * page is on screen.
 */
export function describeList(shown: number, total: number, filter: ListFilter): string {
  const filtered = Boolean(filter.q || filter.status);
  if (shown < total) return `Showing ${shown} of ${total} ${filtered ? "matches" : "customers"}, newest first`;
  if (!filtered) return `${shown} ${shown === 1 ? "customer" : "customers"} in Portland`;
  if (shown === 0) return "No customers match";
  return shown === 1 ? "1 customer matches" : `${shown} customers match`;
}
