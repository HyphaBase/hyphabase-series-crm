/**
 * Episode 2, step 1: define the Customers collection.
 *
 *   npm run setup
 *
 * Safe to run again: the collection is created once.
 */

import { CUSTOMERS, ensureCustomersCollection } from "./customers.js";
import { run } from "./hyphabase.js";

run(async (api) => {
  const { created, collection } = await ensureCustomersCollection(api);

  console.log(created ? `Created the ${CUSTOMERS.name} collection:` : `The ${CUSTOMERS.name} collection already exists:`);
  for (const field of collection.fields) {
    const notes = [field.type, field.required && "required", field.unique && "unique", field.default !== undefined && field.default !== null && `default ${field.default}`];
    console.log(`  ${field.name.padEnd(8)} ${notes.filter(Boolean).join(", ")}`);
  }
});
