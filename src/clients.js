/**
 * Episode 8: the customers move into the Clients module.
 *
 * Until now a customer was a record in a collection we described
 * ourselves (src/customers.js). The Clients module is the same idea,
 * already built: a client has a first and last name, an email, a phone
 * number, a status, and notes. We keep calling them customers in the
 * CRM; "client" is the module's word.
 */

import { CUSTOMERS } from "./customers.js";
import { ApiError } from "./hyphabase.js";

const CLIENTS = "/api/modules/clients";
const STATUSES = `${CLIENTS}/client-statuses`;
const RECORDS = `/api/modules/data/${CUSTOMERS.slug}/records`;

/** A module has no statuses until you name them. These are the three the collection had. */
export const CLIENT_STATUSES = ["Lead", "Active", "Inactive"];

/**
 * Creates the statuses that are missing and returns the id of each, keyed
 * the way the CRM writes them: lead, active, inactive. Safe to run again.
 * Needs the `client_statuses.view` and `client_statuses.manage` scopes.
 */
export async function ensureClientStatuses(api, locationId) {
  const { data: existing } = await api.request(STATUSES, { locationId });
  const created = [];
  const ids = {};

  for (const [position, name] of CLIENT_STATUSES.entries()) {
    let status = existing.find((candidate) => candidate.name === name);
    if (!status) {
      ({ data: status } = await api.request(STATUSES, { method: "POST", locationId, body: { name, sort_order: position + 1 } }));
      created.push(name);
    }
    ids[name.toLowerCase()] = status.id;
  }
  return { created, ids };
}

/**
 * A customer record as the Clients module wants it. The module asks for
 * more than our collection did: a last name and a phone number. A record
 * without them is not guessed at; it comes back with the reason.
 */
export function toClient(record) {
  const [first_name, ...rest] = String(record.name ?? "").trim().split(/\s+/);
  if (!first_name || rest.length === 0) return { ok: false, reason: "has no last name" };
  if (!record.phone) return { ok: false, reason: "has no phone number" };
  return { ok: true, client: { first_name, last_name: rest.join(" "), email: record.email, phone: record.phone } };
}

/** Every record in the customers collection, read one page of 100 at a time. */
async function allCustomerRecords(api) {
  const records = [];
  let cursor = null;
  do {
    const page = await api.request(`${RECORDS}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    records.push(...page.data);
    cursor = page.meta.next_cursor;
  } while (cursor);
  return records;
}

const emailTaken = (error) => error instanceof ApiError && error.status === 422 && Boolean(error.body?.errors?.email);

/**
 * Copies every customer from the collection into the Clients module, with
 * its status. A client whose email is already there is left alone, so it
 * is safe to run again. The collection itself is not touched: delete it
 * when you are sure you no longer need it.
 */
export async function moveCustomers(api, locationId) {
  const { ids } = await ensureClientStatuses(api, locationId);
  const result = { moved: 0, already: 0, skipped: [] };

  for (const record of await allCustomerRecords(api)) {
    const { ok, client, reason } = toClient(record);
    if (!ok) {
      result.skipped.push({ email: record.email, reason });
      continue;
    }

    try {
      const { data: created } = await api.request(CLIENTS, { method: "POST", locationId, body: client });
      await api.request(`${CLIENTS}/${created.id}/statuses`, {
        method: "POST",
        locationId,
        body: { location_id: locationId, client_status_id: ids[record.status] ?? ids.lead },
      });
      result.moved += 1;
    } catch (error) {
      if (!emailTaken(error)) throw error;
      result.already += 1;
    }
  }
  return result;
}
