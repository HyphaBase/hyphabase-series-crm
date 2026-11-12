/**
 * Episode 3, step 3: sign in to the CRM.
 *
 *   npm run crm:signin
 *   npm run crm:signin -- --email marcus@brightsideclean.example
 */

import { parseArgs } from "node:util";

import { askPassword } from "./prompt.js";
import { runClient, saveSession, SESSION_FILE } from "./session.js";

const { values } = parseArgs({ options: { email: { type: "string", default: "sarah@brightsideclean.example" } } });

runClient(async (crm) => {
  const password = await askPassword(`Password for ${values.email}: `);
  const session = await crm.request("/login", { method: "POST", body: { email: values.email, password } });

  saveSession(SESSION_FILE, session);
  console.log(`Signed in as ${session.user.name}.`);
  console.log(`Token saved to ${SESSION_FILE} (valid until ${session.expires_at}).`);
});
