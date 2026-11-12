/**
 * Episode 3, step 2: start the CRM server.
 *
 *   npm run serve
 */

import { createServer } from "node:http";

import { createApi, describeError, loadConfig, requireLocation } from "./hyphabase.js";
import { createApp } from "./server.js";

try {
  const config = loadConfig();
  const app = createApp({ api: createApi(config), locationId: requireLocation(config), log: console.log });
  const port = Number(process.env.PORT ?? 4310);

  // Local only. Put it behind HTTPS before anyone else uses it.
  createServer(app).listen(port, "localhost", () => console.log(`Brightside CRM is listening on http://localhost:${port}`));
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}
