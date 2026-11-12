/**
 * Where a person's session is kept: one cookie in their browser.
 *
 * The cookie is httpOnly, so no script on the page can read the tokens in
 * it, and SameSite=Strict, so another site cannot make the browser send
 * it. The SDK reads and writes the session through the three functions
 * below, which is also how a refreshed token finds its way back into the
 * cookie.
 */

import type { Session, SessionStorageAdapter } from "hyphabase";

export const SESSION_COOKIE = "crm_session";

/** The part of Next's cookie jar this file uses. */
export interface CookieJar {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: Record<string, unknown>): unknown;
  delete(name: string): unknown;
}

export function encodeSession(session: Session): string {
  return Buffer.from(JSON.stringify(session)).toString("base64url");
}

/** The session in a cookie value, or null. The value comes from the browser, so nothing about it is assumed. */
export function decodeSession(value: string | undefined): Session | null {
  if (!value) return null;
  try {
    const s = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const isSession =
      typeof s === "object" && s !== null &&
      typeof s.accessToken === "string" &&
      typeof s.refreshToken === "string" &&
      typeof s.expiresAt === "string" &&
      typeof s.user === "object" && s.user !== null &&
      Array.isArray(s.locationIds);
    return isSession ? (s as Session) : null;
  } catch {
    return null;
  }
}

export function cookieSession(jar: CookieJar): SessionStorageAdapter {
  let current = decodeSession(jar.get(SESSION_COOKIE)?.value);

  return {
    get: () => current,
    set(session) {
      current = session;
      // No expiry: the cookie goes when the browser closes. HyphaBase decides how long the tokens inside it live.
      jar.set(SESSION_COOKIE, encodeSession(session), {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    },
    clear() {
      current = null;
      jar.delete(SESSION_COOKIE);
    },
  };
}
