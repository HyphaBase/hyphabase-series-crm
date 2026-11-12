/**
 * Episode 3, step 4: ask the CRM server for the customers.
 *
 *   npm run crm:customers
 *
 * Works only while you are signed in.
 */

import { runClient } from "./session.js";

runClient(async (crm, session) => {
  const { data: customers } = await crm.request("/customers", { token: session?.token });

  console.log(`Signed in as ${session.user.name}. ${customers.length} customer${customers.length === 1 ? "" : "s"}:`);
  console.table(customers.map(({ name, email, phone, status }) => ({ name, email, phone, status })));
});
