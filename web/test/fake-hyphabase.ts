/**
 * A stand-in for the HyphaBase API, just enough of it for these tests.
 * It answers the way the real API does (checked by `npm run smoke`), and
 * it records every request so a test can ask who each one was sent as.
 */

export const SECRET_KEY = "sk_test_secret";
export const PUBLISHABLE_KEY = "pk_test_publishable";
export const PORTLAND = "11111111-1111-4111-8111-111111111111";
export const SALEM = "22222222-2222-4222-8222-222222222222";

export interface FakeUser {
  id: string;
  name: string;
  email: string;
  password: string;
  permissions: string[];
  locations: string[];
}

export interface Call {
  method: string;
  path: string;
  bearer: string;
  location: string | null;
  /** The query string, as the API would read it: { "filter[name][contains]": "dana", limit: "25" }. */
  query: Record<string, string>;
  body: any;
}

export const people = {
  sarah: (): FakeUser => ({
    id: "u-sarah",
    name: "Sarah Mitchell",
    email: "sarah@brightsideclean.example",
    password: "correct-password",
    permissions: ["data.records.read", "data.records.create", "data.records.update", "data.records.delete"],
    locations: [PORTLAND],
  }),
  marcus: (): FakeUser => ({
    id: "u-marcus",
    name: "Marcus Bell",
    email: "marcus@brightsideclean.example",
    password: "correct-password",
    permissions: ["data.records.read", "data.records.update"],
    locations: [PORTLAND],
  }),
};

export function fakeHyphaBase(users: FakeUser[] = [people.sarah(), people.marcus()]) {
  const calls: Call[] = [];
  const tokens = new Map<string, FakeUser>();
  const refreshTokens = new Map<string, FakeUser>();
  const records: any[] = [
    { id: "c0000000-0000-4000-8000-000000000001", name: "Dana Whitfield", email: "dana@example.com", phone: "555-0142", status: "lead" },
  ];
  let issued = 0;

  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const pair = (user: FakeUser) => {
    issued += 1;
    const token = `token-${issued}`;
    const refresh_token = `refresh-${issued}`;
    tokens.set(token, user);
    refreshTokens.set(refresh_token, user);
    return { token, refresh_token, expires_at: new Date(Date.now() + 3_600_000).toISOString() };
  };

  /**
   * The list grammar, as far as the CRM uses it: contains on name, an exact
   * status, a limit and a cursor. Like the real API it refuses a field or
   * a cursor it does not know with 422, and it never says how many
   * records there are in total.
   */
  const list = (query: Record<string, string>) => {
    let matching = records;
    let limit = 25;
    let after: string | null = null;

    for (const [key, value] of Object.entries(query)) {
      if (key === "sort") continue;
      if (key === "limit") limit = Number(value);
      else if (key === "cursor") {
        try {
          after = JSON.parse(atob(value)).id;
        } catch {
          after = "";
        }
        if (typeof after !== "string" || !records.some((r) => r.id === after)) {
          return json(422, { message: "The cursor does not match this query; start again without one.", errors: { cursor: ["The cursor does not match this query; start again without one."] } });
        }
      } else if (key === "filter[name][contains]") matching = matching.filter((r) => r.name.toLowerCase().includes(value.toLowerCase()));
      else if (key === "filter[status]" || key === "filter[status][eq]") matching = matching.filter((r) => r.status === value);
      else return json(422, { message: "Unknown field.", errors: { [key]: ["Unknown field."] } });
    }

    const start = after ? matching.findIndex((r) => r.id === after) + 1 : 0;
    const page = matching.slice(start, start + limit);
    const more = start + limit < matching.length;
    return json(200, { data: page, meta: { next_cursor: more ? btoa(JSON.stringify({ created_at: "2026-11-23 10:00:00", id: page.at(-1).id })) : null } });
  };

  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const call: Call = {
      method: init.method ?? "GET",
      path: url.pathname,
      bearer: headers.get("Authorization")?.replace(/^Bearer /, "") ?? "",
      location: headers.get("X-Location-Id"),
      query: Object.fromEntries(url.searchParams),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);

    const route = `${call.method} ${call.path}`;
    const isKey = call.bearer === SECRET_KEY || call.bearer === PUBLISHABLE_KEY;

    if (route === "POST /api/auth/login") {
      if (!isKey) return json(401, { message: "Unauthenticated." });
      const user = users.find((u) => u.email === call.body.email && u.password === call.body.password);
      if (!user) return json(422, { message: "The provided credentials are incorrect.", errors: { email: ["The provided credentials are incorrect."] } });
      return json(200, { ...pair(user), user: { id: user.id, name: user.name, email: user.email }, location_ids: user.locations });
    }

    if (route === "POST /api/auth/refresh") {
      const user = refreshTokens.get(call.body.refresh_token);
      if (!user) return json(401, { message: "Unauthenticated." });
      refreshTokens.delete(call.body.refresh_token);
      return json(200, pair(user));
    }

    if (route === "GET /api/auth/me" || route === "GET /api/permissions/me" || route === "POST /api/auth/logout") {
      // The real API answers /permissions/me for a secret key too, with everything the key may do.
      if (call.bearer === SECRET_KEY && route === "GET /api/permissions/me") return json(200, { permissions: ["everything.the.key.can.do"] });
      const user = tokens.get(call.bearer);
      if (!user) return json(401, { message: "Unauthenticated." });
      if (!call.location || !user.locations.includes(call.location)) return json(403, { message: "This credential cannot reach that location." });
      if (route === "POST /api/auth/logout") {
        tokens.delete(call.bearer);
        return json(204);
      }
      if (route === "GET /api/auth/me") return json(200, { user: { id: user.id, name: user.name, email: user.email }, permissions: user.permissions });
      return json(200, { permissions: user.permissions });
    }

    const record = call.path.match(/^\/api\/modules\/data\/customers\/records(?:\/(.+))?$/);
    if (record) {
      if (call.bearer !== SECRET_KEY) return json(403, { message: "Custom data is server-side only in this release: authenticate with a secret (sk_) API key." });
      const id = record[1];
      if (call.method === "GET" && !id) return list(call.query);
      if (call.method === "POST" && !id) {
        if (records.some((r) => r.email === call.body.email)) {
          return json(422, { message: "A record with the same unique value already exists.", errors: { record: ["A record with the same unique value already exists."] } });
        }
        const created = { id: `c0000000-0000-4000-8000-00000000000${records.length + 1}`, phone: null, status: "lead", ...call.body };
        records.unshift(created);
        return json(201, { data: created });
      }
      if (call.method === "PATCH" && id) {
        const existing = records.find((r) => r.id === id);
        if (!existing) return json(404, { message: "Record not found." });
        if (call.body.email !== undefined && records.some((r) => r.id !== id && r.email === call.body.email)) {
          return json(422, { message: "A record with the same unique value already exists.", errors: { record: ["A record with the same unique value already exists."] } });
        }
        Object.assign(existing, call.body);
        return json(200, { data: existing });
      }
      if (call.method === "DELETE" && id) {
        const index = records.findIndex((r) => r.id === id);
        if (index < 0) return json(404, { message: "Record not found." });
        records.splice(index, 1);
        return json(204);
      }
    }

    return json(404, { message: `The fake has no ${route}.` });
  }) as typeof globalThis.fetch;

  return {
    fetch,
    calls,
    records,
    /** Ends a token the way signing out elsewhere or an expiry would. */
    revoke(token: string) {
      tokens.delete(token);
    },
    revokeRefresh(token: string) {
      refreshTokens.delete(token);
    },
  };
}
