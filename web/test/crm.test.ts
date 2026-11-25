import { memoryStorage, type Session, type SessionStorageAdapter } from "hyphabase";
import { describe, expect, it } from "vitest";
import { createCrm } from "../lib/crm";
import { fakeHyphaBase, people, PORTLAND, PUBLISHABLE_KEY, SALEM, SECRET_KEY, STATUS, type Call, type FakeClient, type FakeUser } from "./fake-hyphabase";

const DANA = "c0000000-0000-4000-8000-000000000001";
const NOBODY = "c0000000-0000-4000-8000-00000000ffff";
/** Dana as the browser sees her. */
const dana = { id: DANA, first_name: "Dana", last_name: "Whitfield", name: "Dana Whitfield", email: "dana@example.com", phone: "555-0142", status: "lead" };
const LIAM = { first_name: "Liam", last_name: "Ortiz", email: "liam.ortiz@example.com", phone: "555-0117", status: "active" };

function setup(users?: FakeUser[]) {
  const hyphabase = fakeHyphaBase(users);
  const log: string[] = [];
  // Stands in for the cookie of whoever sent the request. Nobody is signed in to begin with.
  const session = memoryStorage();
  let sender: SessionStorageAdapter = session;
  const crm = createCrm({
    apiUrl: "https://api.test",
    secretKey: SECRET_KEY,
    publishableKey: PUBLISHABLE_KEY,
    locationId: PORTLAND,
    session: () => sender,
    fetch: hyphabase.fetch,
    log: (line) => log.push(line),
  });
  /** The requests that follow come from another browser. */
  const requestsFrom = (other: SessionStorageAdapter) => {
    sender = other;
  };
  return { hyphabase, crm, log, session, requestsFrom };
}

async function signedIn(who: "sarah" | "marcus", users?: FakeUser[]) {
  const context = setup(users);
  const reply = await context.crm.signIn({ email: people[who]().email, password: "correct-password" });
  expect(reply.status).toBe(200);
  context.hyphabase.calls.length = 0;
  return context;
}

/** Every request that was sent to the Clients module. */
const clientCalls = (calls: Call[]) => calls.filter((call) => call.path.includes("/modules/clients"));

describe("signing in", () => {
  it("keeps the session on the server side and tells the browser only who signed in", async () => {
    const { crm, session } = setup();

    const reply = await crm.signIn({ email: "sarah@brightsideclean.example", password: "correct-password" });

    expect(reply).toEqual({ status: 200, body: { user: { id: "u-sarah", name: "Sarah Mitchell", email: "sarah@brightsideclean.example" } } });
    expect(JSON.stringify(reply)).not.toContain("token");
    expect(session.get()?.accessToken).toBe("token-1");
  });

  it("signs in with the publishable key, not the secret one", async () => {
    const { crm, hyphabase } = setup();
    await crm.signIn({ email: "sarah@brightsideclean.example", password: "correct-password" });

    expect(hyphabase.calls[0]).toMatchObject({ path: "/api/auth/login", bearer: PUBLISHABLE_KEY });
  });

  it("refuses a wrong password without saying which half was wrong", async () => {
    const { crm, session } = setup();

    const reply = await crm.signIn({ email: "sarah@brightsideclean.example", password: "nope" });

    expect(reply).toEqual({ status: 401, body: { error: "Wrong email or password." } });
    expect(session.get()).toBeNull();
  });

  it.each([null, "text", {}, { email: "sarah@brightsideclean.example" }, { email: 1, password: 2 }])("asks for an email and a password (%j)", async (body) => {
    const { crm, hyphabase } = setup();

    expect(await crm.signIn(body)).toEqual({ status: 400, body: { error: "Send an email and a password." } });
    expect(hyphabase.calls).toHaveLength(0);
  });

  it("refuses someone whose account does not belong to this location, and ends their session", async () => {
    const elsewhere = { ...people.marcus(), locations: [SALEM] };
    const { crm, hyphabase, session } = setup([elsewhere]);

    const reply = await crm.signIn({ email: elsewhere.email, password: "correct-password" });

    expect(reply).toEqual({ status: 403, body: { error: "Your account does not belong to this location." } });
    expect(session.get()).toBeNull();
    expect(hyphabase.calls.at(-1)).toMatchObject({ path: "/api/auth/logout", bearer: "token-1" });
  });
});

describe("who am I", () => {
  it("answers 401 with no session, and does not call HyphaBase at all", async () => {
    const { crm, hyphabase } = setup();

    expect(await crm.me()).toEqual({ status: 401, body: { error: "Sign in first." } });
    expect(hyphabase.calls).toHaveLength(0);
  });

  it("returns the person and what their role allows, as HyphaBase reports them", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect(await crm.me()).toEqual({
      status: 200,
      body: { user: { id: "u-marcus", name: "Marcus Bell", email: "marcus@brightsideclean.example" }, permissions: ["clients.view", "clients.update"] },
    });
    expect(hyphabase.calls.every((call) => call.bearer === "token-1" && call.location === PORTLAND)).toBe(true);
  });

  it("does not trust the name stored in the session", async () => {
    const { crm, session } = await signedIn("marcus");
    session.set({ ...(session.get() as Session), user: { id: "u-sarah", name: "Sarah Mitchell", email: "sarah@brightsideclean.example" } });

    const reply = await crm.me();

    expect(reply.body).toMatchObject({ user: { name: "Marcus Bell" }, permissions: ["clients.view", "clients.update"] });
  });

  it("answers 401 and forgets the session once HyphaBase no longer accepts it", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");
    hyphabase.revoke("token-1");
    hyphabase.revokeRefresh("refresh-1");

    expect(await crm.me()).toEqual({ status: 401, body: { error: "Your session is not valid. Sign in again." } });
    expect(session.get()).toBeNull();
  });

  it("carries on with a fresh token when the old one has run out, and saves it", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");
    session.set({ ...(session.get() as Session), expiresAt: new Date(Date.now() - 1000).toISOString() });

    const reply = await crm.me();

    expect(reply.status).toBe(200);
    expect(session.get()?.accessToken).toBe("token-2");
    expect(hyphabase.calls[0]).toMatchObject({ path: "/api/auth/refresh" });
  });
});

describe("a forged or stale session", () => {
  const forged: Session = {
    accessToken: "made-up",
    refreshToken: "made-up",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    user: { id: "u-sarah", name: "Sarah Mitchell", email: "sarah@brightsideclean.example" },
    locationIds: [PORTLAND],
  };

  it.each(["me", "listCustomers"] as const)("is refused by %s and never falls back to a key", async (action) => {
    const { crm, hyphabase, session } = setup();
    session.set(forged);

    const reply = await crm[action]();

    expect(reply.status).toBe(401);
    // If the secret key were ever sent in the user's place, HyphaBase would answer with everything the key may do.
    expect(hyphabase.calls.filter((call) => call.bearer === SECRET_KEY || call.bearer === PUBLISHABLE_KEY)).toEqual([]);
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });
});

describe("the customer list", () => {
  it("is refused with no session before any data is read", async () => {
    const { crm, hyphabase } = setup();

    expect((await crm.listCustomers()).status).toBe(401);
    expect(hyphabase.calls).toHaveLength(0);
  });

  it("is refused for someone with no role", async () => {
    const noRole = { ...people.marcus(), permissions: [] };
    const { crm, session, hyphabase, log } = await signedIn("marcus", [noRole]);

    expect(await crm.listCustomers()).toEqual({
      status: 403,
      body: { error: "Your role does not allow this.", required_permission: "clients.view" },
    });
    expect(clientCalls(hyphabase.calls)).toEqual([]);
    expect(log).toContain("marcus@brightsideclean.example was refused: no clients.view");
  });

  it("is refused for someone whose role still carries only the collection's permissions from before episode 8", async () => {
    const before = { ...people.marcus(), permissions: ["data.records.read", "data.records.update"] };
    const { crm, session } = await signedIn("marcus", [before]);

    expect((await crm.listCustomers()).status).toBe(403);
  });

  it("is refused when HyphaBase says the person cannot use this location", async () => {
    const user = people.marcus();
    const { crm, session, hyphabase } = await signedIn("marcus", [user]);
    user.locations = [SALEM];

    expect(await crm.listCustomers()).toEqual({ status: 403, body: { error: "Your account does not belong to this location." } });
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });

  it("reaches staff: who and what are asked as the user, the clients are read as the server", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    const reply = await crm.listCustomers();

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ data: [dana], next_page: null, total: 1 });
    expect(hyphabase.calls.map((call) => [call.path, call.bearer])).toEqual([
      ["/api/auth/me", "token-1"],
      ["/api/permissions/me", "token-1"],
      ["/api/modules/clients", SECRET_KEY],
    ]);
    expect(hyphabase.calls.at(-1)?.location).toBe(PORTLAND);
  });

  it("shows a client that has no status yet as a lead", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    hyphabase.records[0].status = null;

    expect(await crm.listCustomers()).toMatchObject({ body: { data: [{ status: "lead" }] } });
  });
});

describe("finding customers", () => {
  /** Sixty more customers, newest first, every third one active. Dana, the oldest, stays last. */
  function crowd(records: FakeClient[]) {
    for (let n = 1; n <= 60; n++) {
      const number = String(n).padStart(2, "0");
      records.unshift({
        id: `c0000000-0000-4000-8000-0000000001${number}`,
        first_name: n % 10 === 0 ? "Daniel" : "Customer",
        last_name: n % 10 === 0 ? `Reyes ${number}` : number,
        email: `customer-${number}@example.com`,
        phone: `555-01${number}`,
        status: n % 3 === 0 ? STATUS.active : STATUS.lead,
      });
    }
  }

  type Page = { data: { id: string; name: string }[]; next_page: number | null; total: number };
  const pageOf = (reply: { body?: unknown }) => reply.body as Page;
  const names = (reply: { body?: unknown }) => pageOf(reply).data.map((customer) => customer.name);
  const ids = (reply: { body?: unknown }) => pageOf(reply).data.map((customer) => customer.id);
  const FIRST_PAGE = { sort_by: "created_at", sort_direction: "desc", per_page: "25", page: "1" };

  it("is refused with no session, whatever is asked for, before any data is read", async () => {
    const { crm, hyphabase } = setup();

    expect((await crm.listCustomers({ q: "dana", status: "lead" })).status).toBe(401);
    expect(hyphabase.calls).toHaveLength(0);
  });

  it("is refused for someone with no role before the question is even looked at", async () => {
    const noRole = { ...people.marcus(), permissions: [] };
    const { crm, session, hyphabase } = await signedIn("marcus", [noRole]);

    expect((await crm.listCustomers({ page: "not a page" })).status).toBe(403);
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });

  it("returns one page of 25, newest first, the number of the next page and how many there are in all", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    crowd(hyphabase.records);

    const reply = await crm.listCustomers();

    expect(names(reply)).toHaveLength(25);
    expect(names(reply)[0]).toBe("Daniel Reyes 60");
    expect(pageOf(reply)).toMatchObject({ next_page: 2, total: 61 });
    expect(clientCalls(hyphabase.calls)[0].query).toEqual(FIRST_PAGE);
  });

  it("carries on page by page without repeating or skipping anyone, and stops at the end", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    crowd(hyphabase.records);

    const first = await crm.listCustomers();
    const second = await crm.listCustomers({ page: "2" });
    const third = await crm.listCustomers({ page: 3 });

    expect(ids(second)).toHaveLength(25);
    expect(ids(third)).toHaveLength(11);
    expect(new Set([...ids(first), ...ids(second), ...ids(third)]).size).toBe(61);
    expect(names(third).at(-1)).toBe("Dana Whitfield");
    expect(pageOf(third).next_page).toBeNull();
  });

  it("finds customers by part of a name, whatever the capitals", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    crowd(hyphabase.records);

    const reply = await crm.listCustomers({ q: "  dAN " });

    expect(names(reply)).toEqual(["Daniel Reyes 60", "Daniel Reyes 50", "Daniel Reyes 40", "Daniel Reyes 30", "Daniel Reyes 20", "Daniel Reyes 10", "Dana Whitfield"]);
    expect(pageOf(reply)).toMatchObject({ next_page: null, total: 7 });
    expect(clientCalls(hyphabase.calls)[0].query).toEqual({ search: "dAN", ...FIRST_PAGE });
  });

  it("finds customers by part of an email or a phone number too: the module searches all four", async () => {
    const { crm, session } = await signedIn("marcus");

    expect(names(await crm.listCustomers({ q: "dana@" }))).toEqual(["Dana Whitfield"]);
    expect(names(await crm.listCustomers({ q: "0142" }))).toEqual(["Dana Whitfield"]);
  });

  it("narrows by status, alone or together with a search, by asking for the status's id", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    crowd(hyphabase.records);

    const active = await crm.listCustomers({ status: "active" });
    const activeDaniels = await crm.listCustomers({ q: "daniel", status: "active" });

    expect(pageOf(active).total).toBe(20);
    expect(names(activeDaniels)).toEqual(["Daniel Reyes 60", "Daniel Reyes 30"]);
    expect(clientCalls(hyphabase.calls).at(-1)?.query).toEqual({ search: "daniel", client_status_id: STATUS.active, ...FIRST_PAGE });
  });

  it("looks the statuses up once, not for every request", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    await crm.listCustomers({ status: "active" });
    await crm.listCustomers({ status: "lead" });

    expect(hyphabase.calls.filter((call) => call.path.endsWith("/client-statuses"))).toHaveLength(1);
  });

  it("says what to run when the statuses were never created", async () => {
    const { crm, session, hyphabase, log } = await signedIn("marcus");
    hyphabase.statuses.length = 0;

    expect(await crm.listCustomers({ status: "active" })).toEqual({ status: 503, body: { error: "The CRM is not set up yet. Run: npm run clients:setup" } });
    expect(log).toContain("list customers 503");
  });

  it("keeps the search and the status on the next page", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    crowd(hyphabase.records);

    const first = await crm.listCustomers({ q: "customer", status: "lead" });
    const second = await crm.listCustomers({ q: "customer", status: "lead", page: pageOf(first).next_page });

    // Every one of the sixty has "customer" in their email, and forty of them are leads.
    expect(names(first)).toHaveLength(25);
    expect(names(second)).toHaveLength(15);
    expect(clientCalls(hyphabase.calls).at(-1)?.query).toMatchObject({ search: "customer", client_status_id: STATUS.lead, page: "2" });
  });

  it("says nobody matches with an empty page, not an error", async () => {
    const { crm, session } = await signedIn("marcus");

    expect(await crm.listCustomers({ q: "zzz" })).toEqual({ status: 200, body: { data: [], next_page: null, total: 0 } });
  });

  it.each([{ status: "archived" }, { status: "" }, { q: "" }, { q: "   " }, { status: ["active"] }, { q: 7 }])("ignores a filter it does not offer (%j)", async (query) => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect((await crm.listCustomers(query)).status).toBe(200);
    expect(clientCalls(hyphabase.calls)[0].query).toEqual(FIRST_PAGE);
  });

  it("passes on nothing but the search, the status and the page: no field, sort or page size from the browser", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    const reply = await crm.listCustomers({ q: "dana", per_page: "100", sort_by: "email", sort_direction: "asc", include_archived: "true", client_status_id: STATUS.active, search: "liam" });

    expect(reply.status).toBe(200);
    expect(clientCalls(hyphabase.calls)[0].query).toEqual({ search: "dana", ...FIRST_PAGE });
  });

  it("treats what was typed as text to look for, never as part of the query", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    const typed = "%_&client_status_id=x&per_page=100";

    const reply = await crm.listCustomers({ q: typed });

    expect(reply).toEqual({ status: 200, body: { data: [], next_page: null, total: 0 } });
    expect(clientCalls(hyphabase.calls)[0].query).toEqual({ search: typed, ...FIRST_PAGE });
  });

  it("looks for the first 100 characters of a very long search", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    await crm.listCustomers({ q: "a".repeat(500) });

    expect(clientCalls(hyphabase.calls)[0].query.search).toBe("a".repeat(100));
  });

  it.each(["two", "0", "-1", "1.5", "2&per_page=100", "99999", 0, 2.5, ["2"]])("refuses a page that cannot be one, without asking HyphaBase (%j)", async (page) => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect(await crm.listCustomers({ page })).toEqual({ status: 422, body: { error: "That page is not available any more. Start the list again." } });
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });

  it("answers a page past the end with nobody, not an error", async () => {
    const { crm, session } = await signedIn("marcus");

    expect(await crm.listCustomers({ page: "7" })).toEqual({ status: 200, body: { data: [], next_page: null, total: 1 } });
  });
});

describe("adding a customer", () => {
  it("is refused for staff, and nothing is written", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    const reply = await crm.addCustomer(LIAM);

    expect(reply).toEqual({ status: 403, body: { error: "Your role does not allow this.", required_permission: "clients.create" } });
    expect(hyphabase.records).toHaveLength(1);
  });

  it("works for the owner: the client is created, then given its status", async () => {
    const { crm, session, hyphabase, log } = await signedIn("sarah");

    const reply = await crm.addCustomer(LIAM);

    expect(reply.status).toBe(201);
    expect(reply.body).toEqual({ data: { id: expect.any(String), ...LIAM, name: "Liam Ortiz" } });
    expect(hyphabase.records[0]).toMatchObject({ first_name: "Liam", last_name: "Ortiz", status: STATUS.active });
    expect(clientCalls(hyphabase.calls).map((call) => [call.method, call.path.replace(hyphabase.records[0].id, ":id"), call.bearer])).toEqual([
      ["GET", "/api/modules/clients/client-statuses", SECRET_KEY],
      ["POST", "/api/modules/clients", SECRET_KEY],
      ["POST", "/api/modules/clients/:id/statuses", SECRET_KEY],
    ]);
    expect(hyphabase.calls.at(-1)?.body).toEqual({ location_id: PORTLAND, client_status_id: STATUS.active });
    expect(log.some((line) => line.startsWith("sarah@brightsideclean.example added customer "))).toBe(true);
  });

  it("sends only the four client fields on, whatever else the browser adds", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    await crm.addCustomer({ ...LIAM, id: "chosen-by-the-browser", name: "Somebody Else", location_ids: [SALEM], source: "import" });

    expect(clientCalls(hyphabase.calls)[1].body).toEqual({ first_name: "Liam", last_name: "Ortiz", email: LIAM.email, phone: LIAM.phone });
  });

  it("tidies the input, and a customer added without a status starts as a lead", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    const reply = await crm.addCustomer({ first_name: "  Liam ", last_name: " Ortiz  ", email: " Liam.Ortiz@Example.com ", phone: " 555-0117 " });

    expect(clientCalls(hyphabase.calls)[1].body).toEqual({ first_name: "Liam", last_name: "Ortiz", email: "liam.ortiz@example.com", phone: "555-0117" });
    expect(reply.body).toMatchObject({ data: { status: "lead" } });
    expect(hyphabase.records[0].status).toBe(STATUS.lead);
  });

  const everything = { first_name: "Enter a first name.", last_name: "Enter a last name.", email: "Enter an email address.", phone: "Enter a phone number." };

  it.each([
    [{}, everything],
    [{ ...LIAM, email: "not-an-email" }, { email: "Enter a valid email address." }],
    [{ ...LIAM, first_name: "x".repeat(101) }, { first_name: "Keep the first name under 100 characters." }],
    [{ ...LIAM, last_name: "x".repeat(101) }, { last_name: "Keep the last name under 100 characters." }],
    [{ ...LIAM, phone: "" }, { phone: "Enter a phone number." }],
    [{ ...LIAM, phone: "5".repeat(51) }, { phone: "Keep the phone number under 50 characters." }],
    [{ ...LIAM, status: "vip" }, { status: "Choose lead, active or inactive." }],
    [{ first_name: ["Liam"], last_name: 7, email: { $ne: "" }, phone: null }, everything],
    ["not an object", everything],
  ])("refuses input that is not a customer (%j)", async (body, errors) => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    expect(await crm.addCustomer(body)).toEqual({ status: 422, body: { error: "Check the highlighted fields.", errors } });
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });

  it("checks the role before the input, so staff learn nothing from validation", async () => {
    const { crm, session } = await signedIn("marcus");

    expect((await crm.addCustomer({})).status).toBe(403);
  });

  it("says so when the email is already taken", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    expect(await crm.addCustomer({ ...LIAM, email: "dana@example.com" })).toEqual({
      status: 409,
      body: { error: "A customer with that email already exists.", errors: { email: "A customer with that email already exists." } },
    });
    expect(hyphabase.records).toHaveLength(1);
  });

  it("writes nothing when the statuses were never created", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");
    hyphabase.statuses.length = 0;

    expect((await crm.addCustomer(LIAM)).status).toBe(503);
    expect(hyphabase.records).toHaveLength(1);
  });
});

describe("editing a customer", () => {
  it("is refused for someone who can only read, and nothing is changed", async () => {
    const reader = { ...people.marcus(), permissions: ["clients.view"] };
    const { crm, session, hyphabase } = await signedIn("marcus", [reader]);

    const reply = await crm.updateCustomer(DANA, { phone: "555-0143" });

    expect(reply).toEqual({ status: 403, body: { error: "Your role does not allow this.", required_permission: "clients.update" } });
    expect(hyphabase.records[0].phone).toBe("555-0142");
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });

  it("works for staff, and changes only the field that was sent", async () => {
    const { crm, session, hyphabase, log } = await signedIn("marcus");

    const reply = await crm.updateCustomer(DANA, { phone: "555-0143" });

    expect(reply).toEqual({ status: 200, body: { data: { ...dana, phone: "555-0143" } } });
    expect(clientCalls(hyphabase.calls)).toHaveLength(1);
    expect(hyphabase.calls.at(-1)).toMatchObject({ method: "PATCH", path: `/api/modules/clients/${DANA}`, bearer: SECRET_KEY, location: PORTLAND });
    expect(hyphabase.calls.at(-1)?.body).toEqual({ phone: "555-0143" });
    expect(log).toContain(`marcus@brightsideclean.example updated customer ${DANA}`);
  });

  it("changes a status by giving the client another one, and touches nothing else", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    const reply = await crm.updateCustomer(DANA, { status: "active" });

    expect(reply).toEqual({ status: 200, body: { data: { ...dana, status: "active" } } });
    expect(clientCalls(hyphabase.calls).map((call) => [call.method, call.path])).toEqual([
      ["GET", "/api/modules/clients/client-statuses"],
      ["GET", `/api/modules/clients/${DANA}`],
      ["POST", `/api/modules/clients/${DANA}/statuses`],
    ]);
    expect(hyphabase.calls.at(-1)?.body).toEqual({ location_id: PORTLAND, client_status_id: STATUS.active });
  });

  it("works for the owner, with every field at once", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    const reply = await crm.updateCustomer(DANA, { first_name: " Dana ", last_name: " Whitfield-Ross ", email: " Dana.Ross@Example.com ", phone: "555-0150", status: "active" });

    const changed = { first_name: "Dana", last_name: "Whitfield-Ross", email: "dana.ross@example.com", phone: "555-0150" };
    expect(reply).toEqual({ status: 200, body: { data: { id: DANA, ...changed, name: "Dana Whitfield-Ross", status: "active" } } });
    expect(hyphabase.records[0]).toEqual({ id: DANA, ...changed, status: STATUS.active });
  });

  it("sends only the client fields on, whatever else the browser adds", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    await crm.updateCustomer(DANA, { last_name: "Ross", id: "another-id", name: "Somebody Else", location_ids: [SALEM], deleted_at: "2020-01-01" });

    expect(hyphabase.calls.at(-1)?.body).toEqual({ last_name: "Ross" });
  });

  it.each([
    [{ first_name: "" }, { first_name: "Enter a first name." }],
    [{ last_name: "   " }, { last_name: "Enter a last name." }],
    [{ first_name: "x".repeat(101) }, { first_name: "Keep the first name under 100 characters." }],
    [{ email: "" }, { email: "Enter an email address." }],
    [{ email: "not-an-email" }, { email: "Enter a valid email address." }],
    [{ phone: "" }, { phone: "Enter a phone number." }],
    [{ phone: null }, { phone: "Enter a phone number." }],
    [{ phone: "5".repeat(51) }, { phone: "Keep the phone number under 50 characters." }],
    [{ status: "vip" }, { status: "Choose lead, active or inactive." }],
    [{ status: "" }, { status: "Choose lead, active or inactive." }],
    [{ first_name: null, email: { $ne: "" } }, { first_name: "Enter a first name.", email: "Enter an email address." }],
  ])("refuses a change that would leave a bad customer (%j)", async (body, errors) => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    expect(await crm.updateCustomer(DANA, body)).toEqual({ status: 422, body: { error: "Check the highlighted fields.", errors } });
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });

  it.each([{}, { nickname: "D" }, { name: "Dana Ross" }, "not an object", undefined])("refuses a request that changes nothing (%j)", async (body) => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    expect(await crm.updateCustomer(DANA, body)).toEqual({ status: 422, body: { error: "Send at least one field to change." } });
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });

  it("checks the role before the input", async () => {
    const reader = { ...people.marcus(), permissions: ["clients.view"] };
    const { crm, session } = await signedIn("marcus", [reader]);

    expect((await crm.updateCustomer(DANA, {})).status).toBe(403);
  });

  it("says so when the new email belongs to another customer", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");
    await crm.addCustomer(LIAM);

    expect(await crm.updateCustomer(DANA, { email: LIAM.email })).toEqual({
      status: 409,
      body: { error: "A customer with that email already exists.", errors: { email: "A customer with that email already exists." } },
    });
    expect(hyphabase.records.find((r) => r.id === DANA)?.email).toBe("dana@example.com");
  });

  it.each([{ phone: "555-0143" }, { status: "active" }])("answers 404 for a customer that is not there (%j)", async (changes) => {
    const { crm, session } = await signedIn("marcus");

    expect(await crm.updateCustomer(NOBODY, changes)).toEqual({ status: 404, body: { error: "No such customer." } });
  });

  it("answers 404 for an id that cannot be a customer, without asking HyphaBase", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect((await crm.updateCustomer("../client-statuses", { phone: "555-0143" })).status).toBe(404);
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });

  it("is refused with no session before anything else", async () => {
    const { crm, hyphabase } = setup();

    expect((await crm.updateCustomer(DANA, { phone: "555-0143" })).status).toBe(401);
    expect(hyphabase.calls).toHaveLength(0);
  });
});

describe("deleting a customer", () => {
  it("is refused for staff, who can edit but not delete, and the customer is still there", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect(await crm.deleteCustomer(DANA)).toEqual({ status: 403, body: { error: "Your role does not allow this.", required_permission: "clients.delete" } });
    expect(hyphabase.records).toHaveLength(1);
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });

  it("works for the owner", async () => {
    const { crm, session, hyphabase, log } = await signedIn("sarah");

    expect(await crm.deleteCustomer(DANA)).toEqual({ status: 204 });
    expect(hyphabase.records).toHaveLength(0);
    expect(hyphabase.calls.at(-1)).toMatchObject({ method: "DELETE", path: `/api/modules/clients/${DANA}`, bearer: SECRET_KEY });
    expect(log).toContain(`sarah@brightsideclean.example deleted customer ${DANA}`);
  });

  it("answers 404 for a customer that is not there", async () => {
    const { crm, session } = await signedIn("sarah");

    expect(await crm.deleteCustomer(NOBODY)).toEqual({ status: 404, body: { error: "No such customer." } });
  });

  it("answers 404 the second time: HyphaBase still has the archived client, the CRM does not", async () => {
    const { crm, session } = await signedIn("sarah");
    await crm.deleteCustomer(DANA);

    expect(await crm.deleteCustomer(DANA)).toEqual({ status: 404, body: { error: "No such customer." } });
  });

  it("answers 404 for an id that cannot be a customer, without asking HyphaBase", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    expect((await crm.deleteCustomer("../client-statuses")).status).toBe(404);
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });
});

describe("notes on a customer", () => {
  const FIRST = "Prefers morning appointments. Has a dog, so ring the bell twice.";

  it("are refused with no session before anything is asked", async () => {
    const { crm, hyphabase } = setup();

    expect((await crm.listNotes(DANA)).status).toBe(401);
    expect((await crm.addNote(DANA, { content: FIRST })).status).toBe(401);
    expect(hyphabase.calls).toHaveLength(0);
  });

  it("can be added by staff, and HyphaBase records who wrote it and when", async () => {
    const { crm, session, hyphabase, log } = await signedIn("marcus");

    const reply = await crm.addNote(DANA, { content: FIRST });

    expect(reply).toEqual({ status: 201, body: { data: { id: expect.any(String), content: FIRST, author: "Marcus Bell", created_at: "2026-11-24T09:00:00.000000Z" } } });
    expect(hyphabase.notes[0]).toMatchObject({ client_id: DANA, user_id: "u-marcus", content: FIRST });
    expect(log).toContain(`marcus@brightsideclean.example added a note to customer ${DANA}`);
  });

  it("is sent as the person, never as the server, so the author is theirs and not the app's", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    await crm.addNote(DANA, { content: FIRST });

    expect(hyphabase.calls.at(-1)).toMatchObject({ method: "POST", path: `/api/modules/clients/${DANA}/notes`, bearer: "token-1", location: PORTLAND });
    expect(hyphabase.calls.filter((call) => call.bearer === SECRET_KEY)).toEqual([]);
  });

  it("takes the note's text from the browser and nothing else: not the author, the category or who can see it", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    await crm.addNote(DANA, { content: `  ${FIRST}  `, user_id: "u-sarah", author: "Sarah Mitchell", visibility: "public", category: "Billing", created_at: "2020-01-01" });

    expect(hyphabase.calls.at(-1)?.body).toEqual({ category: "General", content: FIRST, visibility: "internal" });
    expect(hyphabase.notes[0].user_id).toBe("u-marcus");
  });

  it("are listed newest first for anyone who can read customers", async () => {
    const reader = { ...people.marcus(), permissions: ["clients.view"] };
    const context = await signedIn("sarah", [people.sarah(), reader]);
    await context.crm.addNote(DANA, { content: FIRST });
    await context.crm.addNote(DANA, { content: "Called to confirm Thursday." });

    const { crm, session, requestsFrom } = context;
    requestsFrom(memoryStorage());
    await crm.signIn({ email: reader.email, password: "correct-password" });
    const reply = await crm.listNotes(DANA);

    // Sarah's own session is untouched by Marcus signing in.
    expect(session.get()?.user.email).toBe(people.sarah().email);

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      data: [
        { id: expect.any(String), content: "Called to confirm Thursday.", author: "Sarah Mitchell", created_at: "2026-11-24T09:01:00.000000Z" },
        { id: expect.any(String), content: FIRST, author: "Sarah Mitchell", created_at: "2026-11-24T09:00:00.000000Z" },
      ],
    });
  });

  it("belong to one customer: another customer's list stays empty", async () => {
    const { crm, session } = await signedIn("sarah");
    const liam = ((await crm.addCustomer(LIAM)).body as { data: { id: string } }).data.id;
    await crm.addNote(DANA, { content: FIRST });

    expect(await crm.listNotes(liam)).toEqual({ status: 200, body: { data: [] } });
  });

  it("cannot be added by someone who can only read, and HyphaBase is not asked", async () => {
    const reader = { ...people.marcus(), permissions: ["clients.view"] };
    const { crm, session, hyphabase } = await signedIn("marcus", [reader]);

    expect(await crm.addNote(DANA, { content: FIRST })).toEqual({ status: 403, body: { error: "Your role does not allow this.", required_permission: "clients.update" } });
    expect(clientCalls(hyphabase.calls)).toEqual([]);
    expect(hyphabase.notes).toHaveLength(0);
  });

  it("cannot be read by someone with no role", async () => {
    const noRole = { ...people.marcus(), permissions: [] };
    const { crm, session, hyphabase } = await signedIn("marcus", [noRole]);

    expect(await crm.listNotes(DANA)).toEqual({ status: 403, body: { error: "Your role does not allow this.", required_permission: "clients.view" } });
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });

  it.each([
    [{}, "Write the note first."],
    [{ content: "   " }, "Write the note first."],
    [{ content: ["a note"] }, "Write the note first."],
    ["not an object", "Write the note first."],
    [{ content: "x".repeat(2001) }, "Keep the note under 2,000 characters."],
  ])("refuses a note that is empty or too long (%j)", async (body, error) => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect(await crm.addNote(DANA, body)).toEqual({ status: 422, body: { error } });
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });

  it("answer 404 for a customer that is not there", async () => {
    const { crm, session } = await signedIn("marcus");

    expect(await crm.listNotes(NOBODY)).toEqual({ status: 404, body: { error: "No such customer." } });
    expect(await crm.addNote(NOBODY, { content: FIRST })).toEqual({ status: 404, body: { error: "No such customer." } });
  });

  it("answer 404 for an id that cannot be a customer, without asking HyphaBase", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect((await crm.listNotes("../client-statuses")).status).toBe(404);
    expect((await crm.addNote(`${DANA}/../${NOBODY}`, { content: FIRST })).status).toBe(404);
    expect(clientCalls(hyphabase.calls)).toEqual([]);
  });
});

describe("signing out", () => {
  it("revokes the token at HyphaBase and forgets the session", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    expect(await crm.signOut()).toEqual({ status: 204 });
    expect(session.get()).toBeNull();
    expect(hyphabase.calls.at(-1)).toMatchObject({ path: "/api/auth/logout", bearer: "token-1" });

    session.set({ accessToken: "token-1", refreshToken: "gone", expiresAt: new Date(Date.now() + 60_000).toISOString(), user: { id: "", name: "", email: "" }, locationIds: [] });
    expect((await crm.listCustomers()).status).toBe(401);
  });

  it("is fine when nobody is signed in", async () => {
    const { crm } = setup();

    expect(await crm.signOut()).toEqual({ status: 204 });
  });
});

describe("when HyphaBase cannot be reached", () => {
  it("answers 502 and keeps the reason in the server's log", async () => {
    const log: string[] = [];
    const crm = createCrm({
      apiUrl: "https://api.test",
      secretKey: SECRET_KEY,
      publishableKey: PUBLISHABLE_KEY,
      locationId: PORTLAND,
      session: memoryStorage,
      fetch: async () => {
        throw new Error("connect ECONNREFUSED 10.1.2.3:443");
      },
      log: (line) => log.push(line),
    });

    const reply = await crm.signIn({ email: "sarah@brightsideclean.example", password: "correct-password" });

    expect(reply).toEqual({ status: 502, body: { error: "The CRM could not reach its backend." } });
    expect(log.join("\n")).toContain("ECONNREFUSED");
  });
});

describe("configuration", () => {
  const config = { apiUrl: "https://api.test", secretKey: SECRET_KEY, publishableKey: PUBLISHABLE_KEY, locationId: PORTLAND, session: memoryStorage };

  it("refuses to start with the keys swapped or missing", () => {
    expect(() => createCrm({ ...config, publishableKey: SECRET_KEY })).toThrow(/HYPHABASE_PUBLISHABLE_KEY/);
    expect(() => createCrm({ ...config, secretKey: PUBLISHABLE_KEY })).toThrow(/HYPHABASE_SECRET_KEY/);
    expect(() => createCrm({ ...config, locationId: "" })).toThrow(/HYPHABASE_LOCATION_ID/);
    expect(() => createCrm({ ...config, apiUrl: "" })).toThrow(/HYPHABASE_API_URL/);
  });
});
