/**
 * Episode 8, step 2: move the customers into the Clients module.
 *
 *   npm run customers:move
 *
 * Copies every customer from the collection, with its status. Safe to run
 * again: clients that are already there are left alone. The collection is
 * left as it was.
 */

import { moveCustomers } from "./clients.js";
import { requireLocation, run } from "./hyphabase.js";

run(async (api, config) => {
  const { moved, already, skipped } = await moveCustomers(api, requireLocation(config));
  console.log(`Moved ${moved} customers into the Clients module.${already ? ` ${already} were already there.` : ""}`);
  for (const { email, reason } of skipped) console.log(`  Not moved: ${email} ${reason}`);
});
