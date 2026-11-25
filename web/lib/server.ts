/**
 * The one CRM the route handlers share, built from the environment.
 *
 * "server-only" makes the build fail if a file that runs in the browser
 * ever imports this one, so the secret key cannot end up in a page by
 * accident.
 */

import "server-only";
import path from "node:path";
import { cookies } from "next/headers";
import { createCrm, type Crm, type Reply } from "./crm";
import { sameOrigin } from "./same-origin";
import { cookieStorage } from "hyphabase";

let crm: Crm | undefined;

/**
 * The keys live in the .env at the top of the repository, the same file
 * the earlier episodes use. Variables that are already set win, so a real
 * deployment sets them the usual way and needs no file. Next.js only gives
 * the browser variables whose names start with NEXT_PUBLIC_, and this app
 * has none.
 */
function loadKeys() {
  try {
    process.loadEnvFile(path.join(process.cwd(), "..", ".env"));
  } catch {
    // No file. createCrm names whatever is missing.
  }
}

/**
 * The session of the request being answered: one cookie in that person's
 * browser, read and written by the SDK. It is httpOnly, so no script on
 * the page can read the tokens in it, and SameSite=Strict, so another site
 * cannot make the browser send it. It has no expiry, so it goes when the
 * browser closes; HyphaBase decides how long the tokens inside it live.
 */
const session = async () =>
  cookieStorage(await cookies(), {
    name: "crm_session",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: null,
  });

function theCrm(): Crm {
  if (!crm) loadKeys();
  crm ??= createCrm({
    apiUrl: process.env.HYPHABASE_API_URL ?? "",
    secretKey: process.env.HYPHABASE_SECRET_KEY ?? "",
    publishableKey: process.env.HYPHABASE_PUBLISHABLE_KEY ?? "",
    locationId: process.env.HYPHABASE_LOCATION_ID ?? "",
    session,
    log: (line) => console.log(line),
  });
  return crm;
}

const json = (reply: Reply) =>
  reply.status === 204 ? new Response(null, { status: 204 }) : Response.json(reply.body, { status: reply.status });

/** Connects one HTTP request to one function of the CRM. */
export async function respond(request: Request, work: (crm: Crm) => Promise<Reply>): Promise<Response> {
  if (!sameOrigin(request)) return json({ status: 403, body: { error: "This request came from another site." } });

  return json(await work(theCrm()));
}

/** The JSON body of a request, or undefined when there is none or it is not JSON. */
export async function bodyOf(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
