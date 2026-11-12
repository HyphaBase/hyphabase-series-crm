/**
 * The client side of the CRM, for now a few terminal commands: it talks to
 * our own server (src/server.js), never to HyphaBase, and never sees the
 * secret key. Signing in saves the token to .session, which is gitignored.
 * A browser app would keep it in memory or a cookie instead.
 */

import { readFileSync, rmSync, writeFileSync } from "node:fs";

export const SESSION_FILE = ".session";
export const CRM_URL = process.env.CRM_URL ?? "http://localhost:4310";

export function saveSession(file, session) {
  writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
}

export function loadSession(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function clearSession(file) {
  rmSync(file, { force: true });
}

export class CrmError extends Error {
  constructor(status, body) {
    super(body?.error ?? `CRM server error ${status}`);
    this.status = status;
  }
}

export function createClient({ url = CRM_URL, fetch = globalThis.fetch } = {}) {
  const base = url.replace(/\/$/, "");

  return {
    async request(path, { method = "GET", body, token } = {}) {
      const headers = { Accept: "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers["Content-Type"] = "application/json";

      const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // Not JSON: something else is answering on this address.
      }

      if (!res.ok) throw new CrmError(res.status, json);
      return json;
    },
  };
}

/** Runs a client command and prints a refusal the way the server worded it. */
export async function runClient(main) {
  try {
    await main(createClient(), loadSession(SESSION_FILE));
  } catch (error) {
    if (error instanceof CrmError) console.error(`${error.status} ${error.message}`);
    else if (error instanceof TypeError) console.error(`Could not reach the CRM server at ${CRM_URL}. Start it with: npm run serve`);
    else console.error(error.message);
    process.exitCode = 1;
  }
}
