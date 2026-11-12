/**
 * Episode 4, step 2: give a user a role.
 *
 *   npm run role:give -- --email sarah@brightsideclean.example --role owner
 *   npm run role:give -- --email marcus@brightsideclean.example --role staff
 *
 * This runs with the secret key, so only you can hand out roles. A signed-in
 * user cannot give themselves one.
 */

import { parseArgs } from "node:util";

import { ApiError, requireLocation, run } from "./hyphabase.js";
import { ensureRole, findUser, giveRole, ROLES } from "./roles.js";

const { values } = parseArgs({ options: { email: { type: "string" }, role: { type: "string" } } });

run(async (api, config) => {
  const locationId = requireLocation(config);
  const definition = ROLES[values.role?.toLowerCase()];
  if (!values.email || !definition) throw new Error(`Usage: npm run role:give -- --email <email> --role <${Object.keys(ROLES).join("|")}>`);

  const user = await findUser(api, locationId, values.email);
  if (!user) throw new Error(`No user with the email ${values.email}. Create them first: npm run user:add -- --email ${values.email}`);

  const { role } = await ensureRole(api, locationId, definition);
  try {
    await giveRole(api, locationId, user.id, role.id);
  } catch (error) {
    // Giving someone a role they already have is not a mistake worth failing on.
    if (!(error instanceof ApiError && error.status === 422 && error.body?.errors?.role_id)) throw error;
    return console.log(`${user.name} already has the ${role.name} role.`);
  }

  console.log(`${user.name} now has the ${role.name} role:`);
  for (const permission of role.permissions) console.log(`  ${permission}`);
});
