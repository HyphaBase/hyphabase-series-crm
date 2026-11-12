/**
 * Episode 4: ask the CRM server who you are and what you may do.
 *
 *   npm run crm:me
 */

import { runClient } from "./session.js";

runClient(async (crm, session) => {
  const { user, permissions } = await crm.request("/me", { token: session?.token });

  console.log(`Signed in as ${user.name} <${user.email}>.`);
  if (permissions.length === 0) return console.log("No role yet, so nothing is allowed.");
  console.log("Allowed:");
  for (const permission of permissions) console.log(`  ${permission}`);
});
