/**
 * Episode 4, step 4: ask the CRM server to delete a customer.
 *
 *   npm run crm:delete -- --email test.entry@example.com
 *
 * Works only if your role allows deleting. The server decides, not this
 * command: a different client sending the same request gets the same answer.
 */

import { parseArgs } from "node:util";

import { runClient } from "./session.js";

const { values } = parseArgs({ options: { email: { type: "string" } } });

runClient(async (crm, session) => {
  if (!values.email) throw new Error("Usage: npm run crm:delete -- --email <customer email>");

  const { data: customers } = await crm.request("/customers", { token: session?.token });
  const customer = customers.find((c) => c.email === values.email);
  if (!customer) throw new Error(`No customer with the email ${values.email}.`);

  await crm.request(`/customers/${customer.id}`, { method: "DELETE", token: session.token });
  console.log(`Deleted customer ${customer.name} <${customer.email}>.`);
});
