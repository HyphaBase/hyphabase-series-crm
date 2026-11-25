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
  /** The query string, as the API would read it: { search: "dana", per_page: "25" }. */
  query: Record<string, string>;
  body: any;
}

/** The ids of the three statuses, as `npm run clients:setup` would have created them. */
export const STATUS = {
  lead: "50000000-0000-4000-8000-000000000001",
  active: "50000000-0000-4000-8000-000000000002",
  inactive: "50000000-0000-4000-8000-000000000003",
};

export interface FakeClient {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  status: string | null;
}

export interface FakeNote {
  id: string;
  client_id: string;
  user_id: string;
  user: { id: string; name: string; email: string };
  category: string;
  content: string;
  visibility: string;
  created_at: string;
  updated_at: string;
}

export const people = {
  sarah: (): FakeUser => ({
    id: "u-sarah",
    name: "Sarah Mitchell",
    email: "sarah@brightsideclean.example",
    password: "correct-password",
    permissions: ["clients.view", "clients.create", "clients.update", "clients.delete"],
    locations: [PORTLAND],
  }),
  marcus: (): FakeUser => ({
    id: "u-marcus",
    name: "Marcus Bell",
    email: "marcus@brightsideclean.example",
    password: "correct-password",
    permissions: ["clients.view", "clients.update"],
    locations: [PORTLAND],
  }),
};

export function fakeHyphaBase(users: FakeUser[] = [people.sarah(), people.marcus()]) {
  const calls: Call[] = [];
  const tokens = new Map<string, FakeUser>();
  const refreshTokens = new Map<string, FakeUser>();
  /** The statuses a client can have. A new environment has none until `npm run clients:setup` names them. */
  const statuses: { id: string; name: string }[] = [
    { id: STATUS.lead, name: "Lead" },
    { id: STATUS.active, name: "Active" },
    { id: STATUS.inactive, name: "Inactive" },
  ];
  /** The clients, newest first. `status` is the id of the status the client has at Portland, or null. */
  const records: FakeClient[] = [
    { id: "c0000000-0000-4000-8000-000000000001", first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", phone: "555-0142", status: STATUS.lead },
  ];
  const notes: FakeNote[] = [];
  // A deleted client is archived, not gone: its email stays taken and it cannot be archived twice.
  const archived: FakeClient[] = [];
  let issued = 0;
  let made = 1;

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

  /** A client the way the Clients module returns one. */
  const shown = (client: FakeClient) => {
    const status = statuses.find((candidate) => candidate.id === client.status);
    return {
      id: client.id,
      first_name: client.first_name,
      last_name: client.last_name,
      name: `${client.first_name} ${client.last_name}`,
      email: client.email,
      phone: client.phone,
      source: "local",
      location_ids: [PORTLAND],
      location_statuses: status ? [{ id: `ls-${client.id}`, client_id: client.id, location_id: PORTLAND, status, status_label: status.name }] : [],
      created_at: "2026-11-23T10:00:00.000000Z",
      updated_at: "2026-11-23T10:00:00.000000Z",
    };
  };

  /**
   * The list, as far as the CRM uses it. Like the real API, `search` looks
   * in the first name, the last name, the email and the phone number one
   * at a time (so "dana whit" finds nobody), a page past the end is empty,
   * and a parameter it does not know is ignored.
   */
  const list = (query: Record<string, string>) => {
    const search = (query.search ?? "").toLowerCase();
    const perPage = Number(query.per_page ?? 15);
    const page = Number(query.page ?? 1);

    let matching = records;
    if (search) matching = matching.filter((r) => [r.first_name, r.last_name, r.email, r.phone].some((value) => value.toLowerCase().includes(search)));
    if (query.client_status_id) matching = matching.filter((r) => r.status === query.client_status_id);

    const data = matching.slice((page - 1) * perPage, page * perPage).map(shown);
    return json(200, { data, meta: { current_page: page, last_page: Math.max(1, Math.ceil(matching.length / perPage)), per_page: perPage, total: matching.length } });
  };

  const emailTaken = (id: string) => {
    const message = `A client with this email already exists (id ${id}).`;
    return json(422, { message, errors: { email: [message] } });
  };

  const missing = () => json(404, { message: "No query results for model [HyphaBase\\Clients\\Models\\Client]." });

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

    if (route === "GET /api/modules/clients/client-statuses") {
      if (call.bearer !== SECRET_KEY) return json(403, { message: "Not the server." });
      return json(200, { data: statuses });
    }

    // Notes are sent as the person, so HyphaBase checks their role itself and records who wrote each one.
    const note = call.path.match(/^\/api\/modules\/clients\/([^/]+)\/notes$/);
    if (note) {
      const user = tokens.get(call.bearer);
      if (!user) return json(401, { message: "Unauthenticated." });
      if (!call.location || !user.locations.includes(call.location)) return json(403, { message: "This credential cannot reach that location." });
      const needed = call.method === "GET" ? "clients.view" : "clients.update";
      if (!user.permissions.includes(needed)) return json(403, { message: `Your role does not include the '${needed}' permission.`, required_permission: needed });
      if (!records.some((r) => r.id === note[1])) return missing();

      if (call.method === "GET") return json(200, { data: notes.filter((n) => n.client_id === note[1]) });
      if (call.method === "POST") {
        const created: FakeNote = {
          id: `n0000000-0000-4000-8000-00000000000${notes.length + 1}`,
          client_id: note[1],
          user_id: user.id,
          user: { id: user.id, name: user.name, email: user.email },
          category: call.body.category,
          content: call.body.content,
          visibility: call.body.visibility,
          created_at: `2026-11-24T09:0${notes.length}:00.000000Z`,
          updated_at: `2026-11-24T09:0${notes.length}:00.000000Z`,
        };
        notes.unshift(created);
        return json(201, { data: created });
      }
    }

    const assign = call.path.match(/^\/api\/modules\/clients\/([^/]+)\/statuses$/);
    if (assign && call.method === "POST") {
      if (call.bearer !== SECRET_KEY) return json(403, { message: "Not the server." });
      const existing = records.find((r) => r.id === assign[1]);
      if (!existing) return missing();
      if (!statuses.some((status) => status.id === call.body.client_status_id)) return json(422, { message: "The selected client status id is invalid.", errors: { client_status_id: ["The selected client status id is invalid."] } });
      existing.status = call.body.client_status_id;
      return json(201, { data: shown(existing).location_statuses[0] });
    }

    const client = call.path.match(/^\/api\/modules\/clients(?:\/([^/]+))?$/);
    if (client) {
      // The CRM reads and writes clients as the server, after it has checked the person's role itself.
      if (call.bearer !== SECRET_KEY) return json(403, { message: "Not the server." });
      if (call.location !== PORTLAND) return json(400, { message: "Send X-Location-Id." });
      const id = client[1];
      if (call.method === "GET" && !id) return list(call.query);
      if (call.method === "POST" && !id) {
        const taken = [...records, ...archived].find((r) => r.email === call.body.email);
        if (taken) return emailTaken(taken.id);
        made += 1;
        const created: FakeClient = { id: `c0000000-0000-4000-8000-00000000000${made}`, status: null, ...call.body };
        records.unshift(created);
        return json(201, { data: shown(created) });
      }
      const existing = records.find((r) => r.id === id);
      if (!existing && call.method === "DELETE" && archived.some((r) => r.id === id)) {
        return json(409, { message: "Client is already archived. Restore it or permanently delete it instead." });
      }
      if (!existing) return missing();
      if (call.method === "GET") return json(200, { data: shown(existing) });
      if (call.method === "PATCH") {
        const taken = call.body.email === undefined ? undefined : records.find((r) => r.id !== id && r.email === call.body.email);
        if (taken) return emailTaken(taken.id);
        Object.assign(existing, call.body);
        return json(200, { data: shown(existing) });
      }
      if (call.method === "DELETE") {
        archived.push(...records.splice(records.indexOf(existing), 1));
        return json(200, { message: "Client archived successfully. You can restore it within 30 days." });
      }
    }

    return json(404, { message: `The fake has no ${route}.` });
  }) as typeof globalThis.fetch;

  return {
    fetch,
    calls,
    records,
    statuses,
    notes,
    /** Ends a token the way signing out elsewhere or an expiry would. */
    revoke(token: string) {
      tokens.delete(token);
    },
    revokeRefresh(token: string) {
      refreshTokens.delete(token);
    },
  };
}
