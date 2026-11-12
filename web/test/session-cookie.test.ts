import { describe, expect, it } from "vitest";
import type { Session } from "hyphabase";
import { cookieSession, decodeSession, encodeSession, SESSION_COOKIE } from "../lib/session-cookie";
import { sameOrigin } from "../lib/same-origin";

const session: Session = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: "2030-01-01T00:00:00Z",
  user: { id: "u1", name: "Sarah Mitchell", email: "sarah@brightsideclean.example" },
  locationIds: ["loc-1"],
};

function fakeJar(initial?: string) {
  const values = new Map<string, string>(initial ? [[SESSION_COOKIE, initial]] : []);
  const sets: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  return {
    values,
    sets,
    get: (name: string) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      values.set(name, value);
      sets.push({ name, value, options });
    },
    delete: (name: string) => void values.delete(name),
  };
}

describe("the session cookie", () => {
  it("round-trips a session", () => {
    expect(decodeSession(encodeSession(session))).toEqual(session);
  });

  it("treats anything that is not a session as no session", () => {
    for (const value of [undefined, "", "not base64 json", encodeSession({ ...session, accessToken: 7 } as never), Buffer.from("[1]").toString("base64url")]) {
      expect(decodeSession(value)).toBeNull();
    }
  });

  it("is written so that scripts cannot read it and other sites cannot send it", () => {
    const jar = fakeJar();
    cookieSession(jar).set(session);

    expect(jar.sets).toHaveLength(1);
    expect(jar.sets[0].options).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
    expect(jar.sets[0].options).not.toHaveProperty("maxAge");
    expect(jar.sets[0].options).not.toHaveProperty("expires");
  });

  it("reads back what was stored, and forgets it when cleared", () => {
    const jar = fakeJar(encodeSession(session));
    const store = cookieSession(jar);
    expect(store.get()).toEqual(session);

    store.set({ ...session, accessToken: "access-2" });
    expect(store.get()?.accessToken).toBe("access-2");

    store.clear();
    expect(store.get()).toBeNull();
    expect(jar.values.has(SESSION_COOKIE)).toBe(false);
  });
});

describe("same-origin check", () => {
  const request = (headers: Record<string, string>) => new Request("http://crm.test/api/customers", { method: "POST", headers });

  it("accepts a request from the app's own pages", () => {
    expect(sameOrigin(request({ host: "crm.test", origin: "http://crm.test" }))).toBe(true);
    expect(sameOrigin(request({ host: "localhost:3010", origin: "https://dev-crm.example", "x-forwarded-host": "dev-crm.example" }))).toBe(true);
  });

  it("accepts a request with no Origin header, such as curl", () => {
    expect(sameOrigin(request({ host: "crm.test" }))).toBe(true);
  });

  it("refuses a request from another site", () => {
    expect(sameOrigin(request({ host: "crm.test", origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(request({ host: "crm.test", origin: "null" }))).toBe(false);
  });
});
