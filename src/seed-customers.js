/**
 * Episode 7: fill the customer list with sixty sample customers.
 *
 *   npm run customer:seed
 *
 * Safe to run again: customers that are already there are left alone.
 */

import { run } from "./hyphabase.js";
import { seedCustomers } from "./seed.js";

run(async (api) => {
  const { added, skipped } = await seedCustomers(api);
  console.log(`Added ${added} sample customers.${skipped ? ` ${skipped} were already there.` : ""}`);
});
