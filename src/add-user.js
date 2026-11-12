/**
 * Episode 3, step 1: create a user who can sign in to the CRM.
 *
 *   npm run user:add
 *   npm run user:add -- --name "Marcus Bell" --email marcus@brightsideclean.example
 *
 * You are asked for the password; HyphaBase stores it hashed. This runs
 * with the secret key, so only you can create users. People cannot sign
 * themselves up to this CRM.
 */

import { parseArgs } from "node:util";

import { addUser } from "./auth.js";
import { requireLocation, run } from "./hyphabase.js";
import { askPassword } from "./prompt.js";

const { values } = parseArgs({
  options: {
    name: { type: "string", default: "Sarah Mitchell" },
    email: { type: "string", default: "sarah@brightsideclean.example" },
  },
});

run(async (api, config) => {
  const locationId = requireLocation(config);
  const password = await askPassword(`Password for ${values.email}: `);

  const user = await addUser(api, locationId, { ...values, password });
  console.log(`Created user ${user.name} <${user.email}>`);
  console.log(`  id        ${user.id}`);
  console.log(`  location  ${user.locations.map((location) => location.name).join(", ")}`);
});
