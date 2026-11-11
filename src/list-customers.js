/**
 * Episode 2, step 3: list every customer, newest first.
 *
 *   npm run customer:list
 */

import { listCustomers } from "./customers.js";
import { run } from "./hyphabase.js";

run(async (api) => {
  const customers = await listCustomers(api);

  if (customers.length === 0) {
    console.log("No customers yet. Add one with: npm run customer:add");
    return;
  }

  console.table(customers.map(({ name, email, phone, status }) => ({ name, email, phone, status })));
});
