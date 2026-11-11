/**
 * Episode 2, step 2: create a customer, then read it back by id.
 *
 *   npm run customer:add
 *   npm run customer:add -- --name "Liam Ortiz" --email liam.ortiz@example.com --status active
 *
 * Every customer in this series is made up. Don't put real people in a demo.
 */

import { parseArgs } from "node:util";

import { addCustomer, getCustomer } from "./customers.js";
import { run } from "./hyphabase.js";

const { values } = parseArgs({
  options: {
    name: { type: "string", default: "Dana Whitfield" },
    email: { type: "string", default: "dana@example.com" },
    phone: { type: "string", default: "555-0142" },
    status: { type: "string" },
  },
});

run(async (api) => {
  // No status sent unless you pass one: the collection's default ("lead") applies.
  const created = await addCustomer(api, values);
  console.log(`Created customer ${created.id}`);

  const customer = await getCustomer(api, created.id);
  console.log("Read it back from the API:");
  console.log(customer);
});
