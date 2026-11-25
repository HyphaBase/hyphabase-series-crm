/**
 * Episode 8, step 1: name the statuses a client can have.
 *
 *   npm run clients:setup
 *
 * Lead, Active and Inactive, the same three the collection had. Safe to
 * run again: statuses that are already there are left alone.
 */

import { ensureClientStatuses } from "./clients.js";
import { requireLocation, run } from "./hyphabase.js";

run(async (api, config) => {
  const { created, ids } = await ensureClientStatuses(api, requireLocation(config));
  for (const name of Object.keys(ids)) {
    const label = name[0].toUpperCase() + name.slice(1);
    console.log(`${created.includes(label) ? "Created" : "Already there:"} status ${label}`);
  }
});
