/**
 * Episode 4, step 1: define the CRM's roles.
 *
 *   npm run roles:setup
 *
 * Two roles: Owner (read, add, edit and delete customers) and Staff (read
 * and edit). Editing arrived in episode 6. Safe to run again: a role that
 * is already there only gains the permissions it is missing.
 */

import { requireLocation, run } from "./hyphabase.js";
import { ensureRole, ROLES } from "./roles.js";

run(async (api, config) => {
  const locationId = requireLocation(config);

  for (const definition of Object.values(ROLES)) {
    const { created, updated, role } = await ensureRole(api, locationId, definition);
    console.log(`${created ? "Created" : updated ? "Updated" : "Already there:"} role ${role.name}`);
    for (const permission of role.permissions) console.log(`  ${permission}`);
  }
});
