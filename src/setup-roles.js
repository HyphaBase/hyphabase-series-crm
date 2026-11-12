/**
 * Episode 4, step 1: define the CRM's roles.
 *
 *   npm run roles:setup
 *
 * Two roles: Owner (read, add and delete customers) and Staff (read only).
 * Safe to run again; existing roles are left as they are.
 */

import { requireLocation, run } from "./hyphabase.js";
import { ensureRole, ROLES } from "./roles.js";

run(async (api, config) => {
  const locationId = requireLocation(config);

  for (const definition of Object.values(ROLES)) {
    const { created, role } = await ensureRole(api, locationId, definition);
    console.log(`${created ? "Created" : "Already there:"} role ${role.name}`);
    for (const permission of role.permissions) console.log(`  ${permission}`);
  }
});
