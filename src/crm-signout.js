/**
 * Episode 3, step 5: sign out. The token stops working straight away.
 *
 *   npm run crm:signout
 */

import { clearSession, runClient, SESSION_FILE } from "./session.js";

runClient(async (crm, session) => {
  if (!session) return console.log("You are not signed in.");

  await crm.request("/logout", { method: "POST", token: session.token });
  clearSession(SESSION_FILE);
  console.log(`Signed out ${session.user.name}.`);
});
