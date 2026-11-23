/**
 * Sixty sample customers, so the list is long enough to need a search
 * box and a second page (episode 7).
 *
 * Every one of them is made up. The emails end in example.com, which
 * belongs to nobody, and the phone numbers are 555-01xx, the range kept
 * for fiction. Don't put real people in a demo.
 */

import { CUSTOMERS } from "./customers.js";

const RECORDS = `/api/modules/data/${CUSTOMERS.slug}/records`;

// One request creates at most this many records.
const BATCH = 100;

const NAMES = [
  "Aaliyah Brooks", "Abel Fontaine", "Adaeze Okafor", "Alma Reinholt", "Amara Castillo", "Anders Lindqvist",
  "Beatrix Holloway", "Bodhi Tanaka", "Callum Ashby", "Camila Duarte", "Cedric Vance", "Chiara Lombardi",
  "Daniel Okonkwo", "Danielle Whitlock", "Dante Marchetti", "Delia Abernathy", "Devika Raman", "Elias Thornbury",
  "Elodie Marchand", "Esperanza Quintero", "Ezra Feldman", "Farah Siddiqui", "Felix Brandt", "Freya Halvorsen",
  "Gideon Ashcroft", "Greta Novak", "Hana Kobayashi", "Hugo Beaumont", "Imani Carver", "Isidore Lang",
  "Jordan Blakely", "Josefina Arroyo", "Kofi Mensah", "Laleh Farrokhzad", "Leona Whitaker", "Linus Bergstrom",
  "Maeve Gallagher", "Mateo Villanueva", "Mirela Costin", "Nadia Petrova", "Nikhil Banerjee", "Noor Haddad",
  "Octavia Sterling", "Omari Baptiste", "Paloma Reyes", "Quentin Lowry", "Rafaela Monteiro", "Roderick Finch",
  "Rosalind Mercer", "Sanjana Iyer", "Soren Kjeldsen", "Tamsin Hartley", "Tobias Engel", "Uma Deshpande",
  "Valentina Ricci", "Wendell Pryor", "Ximena Cordero", "Yusuf Demir", "Zainab Rahimi", "Zeke Holbrook",
];

// One in five is a lead, one in five has stopped being a customer, the rest are active.
const STATUSES = ["lead", "active", "active", "inactive", "active"];

export const SAMPLE_CUSTOMERS = NAMES.map((name, n) => ({
  name,
  email: `${name.toLowerCase().replace(" ", ".")}@example.com`,
  phone: `555-01${String(20 + n).padStart(2, "0")}`,
  status: STATUSES[n % STATUSES.length],
}));

/** The email of every customer there is, read one page of 100 at a time. */
async function existingEmails(api) {
  const emails = new Set();
  let cursor = null;
  do {
    const page = await api.request(`${RECORDS}?select=email&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    for (const record of page.data) emails.add(record.email);
    cursor = page.meta.next_cursor;
  } while (cursor);
  return emails;
}

/**
 * Adds the customers that are not there yet, found by email, so running
 * it twice adds nothing the second time. A batch is all or none: if
 * HyphaBase refuses one record, none of that batch is created.
 */
export async function seedCustomers(api, customers = SAMPLE_CUSTOMERS) {
  const existing = await existingEmails(api);
  const missing = customers.filter((customer) => !existing.has(customer.email));

  for (let start = 0; start < missing.length; start += BATCH) {
    await api.request(`${RECORDS}/batch`, { method: "POST", body: { records: missing.slice(start, start + BATCH) } });
  }
  return { added: missing.length, skipped: customers.length - missing.length };
}
