import { memoryStorage, type Session } from "hyphabase";
import { describe, expect, it } from "vitest";
import { createCrm } from "../lib/crm";
import { fakeHyphaBase, people, PORTLAND, PUBLISHABLE_KEY, SALEM, SECRET_KEY, type Call, type FakeUser } from "./fake-hyphabase";

const DANA = "c0000000-0000-4000-8000-000000000001";
const LIAM = { name: "Liam Ortiz", email: "liam.ortiz@example.com", phone: "555-0117", status: "active" };

function setup(users?: FakeUser[]) {
  const hyphabase = fakeHyphaBase(users);
  const log: string[] = [];
  const crm = createCrm({
    apiUrl: "https://api.test",
    secretKey: SECRET_KEY,
    publishableKey: PUBLISHABLE_KEY,
    locationId: PORTLAND,
    fetch: hyphabase.fetch,
    log: (line) => log.push(line),
  });
  return { hyphabase, crm, log };
}

async function signedIn(who: "sarah" | "marcus", users?: FakeUser[]) {
  const context = setup(users);
  const session = memoryStorage();
  const reply = await context.crm.signIn(session, { email: people[who]().email, password: "correct-password" });
  expect(reply.status).toBe(200);
  context.hyphabase.calls.length = 0;
  return { ...context, session };
}

/** Every request that was sent to the customers data API. */
const dataCalls = (calls: Call[]) => calls.filter((call) => call.path.includes("/modules/data/"));

describe("signing in", () => {
  it("keeps the session on the server side and tells the browser only who signed in", async () => {
    const { crm } = setup();
    const session = memoryStorage();

    const reply = await crm.signIn(session, { email: "sarah@brightsideclean.example", password: "correct-password" });

    expect(reply).toEqual({ status: 200, body: { user: { id: "u-sarah", name: "Sarah Mitchell", email: "sarah@brightsideclean.example" } } });
    expect(JSON.stringify(reply)).not.toContain("token");
    expect(session.get()?.accessToken).toBe("token-1");
  });

  it("signs in with the publishable key, not the secret one", async () => {
    const { crm, hyphabase } = setup();
    await crm.signIn(memoryStorage(), { email: "sarah@brightsideclean.example", password: "correct-password" });

    expect(hyphabase.calls[0]).toMatchObject({ path: "/api/auth/login", bearer: PUBLISHABLE_KEY });
  });

  it("refuses a wrong password without saying which half was wrong", async () => {
    const { crm } = setup();
    const session = memoryStorage();

    const reply = await crm.signIn(session, { email: "sarah@brightsideclean.example", password: "nope" });

    expect(reply).toEqual({ status: 401, body: { error: "Wrong email or password." } });
    expect(session.get()).toBeNull();
  });

  it.each([null, "text", {}, { email: "sarah@brightsideclean.example" }, { email: 1, password: 2 }])("asks for an email and a password (%j)", async (body) => {
    const { crm, hyphabase } = setup();

    expect(await crm.signIn(memoryStorage(), body)).toEqual({ status: 400, body: { error: "Send an email and a password." } });
    expect(hyphabase.calls).toHaveLength(0);
  });

  it("refuses someone whose account does not belong to this location, and ends their session", async () => {
    const elsewhere = { ...people.marcus(), locations: [SALEM] };
    const { crm, hyphabase } = setup([elsewhere]);
    const session = memoryStorage();

    const reply = await crm.signIn(session, { email: elsewhere.email, password: "correct-password" });

    expect(reply).toEqual({ status: 403, body: { error: "Your account does not belong to this location." } });
    expect(session.get()).toBeNull();
    expect(hyphabase.calls.at(-1)).toMatchObject({ path: "/api/auth/logout", bearer: "token-1" });
  });
});

describe("who am I", () => {
  it("answers 401 with no session, and does not call HyphaBase at all", async () => {
    const { crm, hyphabase } = setup();

    expect(await crm.me(memoryStorage())).toEqual({ status: 401, body: { error: "Sign in first." } });
    expect(hyphabase.calls).toHaveLength(0);
  });

  it("returns the person and what their role allows, as HyphaBase reports them", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect(await crm.me(session)).toEqual({
      status: 200,
      body: { user: { id: "u-marcus", name: "Marcus Bell", email: "marcus@brightsideclean.example" }, permissions: ["data.records.read", "data.records.update"] },
    });
    expect(hyphabase.calls.every((call) => call.bearer === "token-1" && call.location === PORTLAND)).toBe(true);
  });

  it("does not trust the name stored in the session", async () => {
    const { crm, session } = await signedIn("marcus");
    session.set({ ...(session.get() as Session), user: { id: "u-sarah", name: "Sarah Mitchell", email: "sarah@brightsideclean.example" } });

    const reply = await crm.me(session);

    expect(reply.body).toMatchObject({ user: { name: "Marcus Bell" }, permissions: ["data.records.read", "data.records.update"] });
  });

  it("answers 401 and forgets the session once HyphaBase no longer accepts it", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");
    hyphabase.revoke("token-1");
    hyphabase.revokeRefresh("refresh-1");

    expect(await crm.me(session)).toEqual({ status: 401, body: { error: "Your session is not valid. Sign in again." } });
    expect(session.get()).toBeNull();
  });

  it("carries on with a fresh token when the old one has run out, and saves it", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");
    session.set({ ...(session.get() as Session), expiresAt: new Date(Date.now() - 1000).toISOString() });

    const reply = await crm.me(session);

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
    const { crm, hyphabase } = setup();
    const session = memoryStorage();
    session.set(forged);

    const reply = await crm[action](session);

    expect(reply.status).toBe(401);
    // If the secret key were ever sent in the user's place, HyphaBase would answer with everything the key may do.
    expect(hyphabase.calls.filter((call) => call.bearer === SECRET_KEY || call.bearer === PUBLISHABLE_KEY)).toEqual([]);
    expect(dataCalls(hyphabase.calls)).toEqual([]);
  });
});

describe("the customer list", () => {
  it("is refused with no session before any data is read", async () => {
    const { crm, hyphabase } = setup();

    expect((await crm.listCustomers(memoryStorage())).status).toBe(401);
    expect(hyphabase.calls).toHaveLength(0);
  });

  it("is refused for someone with no role", async () => {
    const noRole = { ...people.marcus(), permissions: [] };
    const { crm, session, hyphabase, log } = await signedIn("marcus", [noRole]);

    expect(await crm.listCustomers(session)).toEqual({
      status: 403,
      body: { error: "Your role does not allow this.", required_permission: "data.records.read" },
    });
    expect(dataCalls(hyphabase.calls)).toEqual([]);
    expect(log).toContain("marcus@brightsideclean.example was refused: no data.records.read");
  });

  it("is refused when HyphaBase says the person cannot use this location", async () => {
    const user = people.marcus();
    const { crm, session, hyphabase } = await signedIn("marcus", [user]);
    user.locations = [SALEM];

    expect(await crm.listCustomers(session)).toEqual({ status: 403, body: { error: "Your account does not belong to this location." } });
    expect(dataCalls(hyphabase.calls)).toEqual([]);
  });

  it("reaches staff: who and what are asked as the user, the data is read as the server", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    const reply = await crm.listCustomers(session);

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ data: [{ id: DANA, name: "Dana Whitfield", email: "dana@example.com", phone: "555-0142", status: "lead" }], next_cursor: null });
    expect(hyphabase.calls.map((call) => [call.path, call.bearer])).toEqual([
      ["/api/auth/me", "token-1"],
      ["/api/permissions/me", "token-1"],
      ["/api/modules/data/customers/records", SECRET_KEY],
    ]);
  });
});

describe("finding customers", () => {
  /** Sixty more customers, newest first, every third one active. Dana, the oldest, stays last. */
  function crowd(records: any[]) {
    for (let n = 1; n <= 60; n++) {
      const number = String(n).padStart(2, "0");
      records.unshift({
        id: `c0000000-0000-4000-8000-0000000001${number}`,
        name: n % 10 === 0 ? `Daniel Reyes ${number}` : `Customer ${number}`,
        email: `customer-${number}@example.com`,
        phone: null,
        status: n % 3 === 0 ? "active" : "lead",
      });
    }
  }

  const names = (reply: { body?: unknown }) => (reply.body as { data: { name: string }[] }).data.map((customer) => customer.name);
  const ids = (reply: { body?: unknown }) => (reply.body as { data: { id: string }[] }).data.map((customer) => customer.id);
  const cursorOf = (reply: { body?: unknown }) => (reply.body as { next_cursor: string | null }).next_cursor;

  it("is refused with no session, whatever is asked for, before any data is read", async () => {
    const { crm, hyphabase } = setup();

    expect((await crm.listCustomers(memoryStorage(), { q: "dana", status: "lead" })).status).toBe(401);
    expect(hyphabase.calls).toHaveLength(0);
  });

  it("is refused for someone with no role before the question is even looked at", async () => {
    const noRole = { ...people.marcus(), permissions: [] };
    const { crm, session, hyphabase } = await signedIn("marcus", [noRole]);

    expect((await crm.listCustomers(session, { cursor: "not a cursor" })).status).toBe(403);
    expect(dataCalls(hyphabase.calls)).toEqual([]);
  });

  it("returns one page of 25, newest first, and a cursor for the next", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    crowd(hyphabase.records);

    const reply = await crm.listCustomers(session);

    expect(names(reply)).toHaveLength(25);
    expect(names(reply)[0]).toBe("Daniel Reyes 60");
    expect(cursorOf(reply)).toEqual(expect.any(String));
    expect(dataCalls(hyphabase.calls)[0].query).toEqual({ sort: "-created_at", limit: "25" });
  });

  it("carries on from the cursor without repeating or skipping anyone, and stops at the end", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    crowd(hyphabase.records);

    const first = await crm.listCustomers(session);
    const second = await crm.listCustomers(session, { cursor: cursorOf(first) });
    const third = await crm.listCustomers(session, { cursor: cursorOf(second) });

    expect(ids(second)).toHaveLength(25);
    expect(ids(third)).toHaveLength(11);
    expect(new Set([...ids(first), ...ids(second), ...ids(third)]).size).toBe(61);
    expect(names(third).at(-1)).toBe("Dana Whitfield");
    expect(cursorOf(third)).toBeNull();
  });

  it("finds customers by part of a name, whatever the capitals", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    crowd(hyphabase.records);

    const reply = await crm.listCustomers(session, { q: "  dAN " });

    expect(names(reply)).toEqual(["Daniel Reyes 60", "Daniel Reyes 50", "Daniel Reyes 40", "Daniel Reyes 30", "Daniel Reyes 20", "Daniel Reyes 10", "Dana Whitfield"]);
    expect(cursorOf(reply)).toBeNull();
    expect(dataCalls(hyphabase.calls)[0].query).toEqual({ "filter[name][contains]": "dAN", sort: "-created_at", limit: "25" });
  });

  it("narrows by status, alone or together with a name", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    crowd(hyphabase.records);

    const active = await crm.listCustomers(session, { status: "active" });
    const activeDaniels = await crm.listCustomers(session, { q: "daniel", status: "active" });

    expect(names(active)).toHaveLength(20);
    expect(names(activeDaniels)).toEqual(["Daniel Reyes 60", "Daniel Reyes 30"]);
    expect(dataCalls(hyphabase.calls)[1].query).toEqual({ "filter[name][contains]": "daniel", "filter[status]": "active", sort: "-created_at", limit: "25" });
  });

  it("keeps the search and the status on the next page", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    crowd(hyphabase.records);

    const first = await crm.listCustomers(session, { q: "customer", status: "lead" });
    const second = await crm.listCustomers(session, { q: "customer", status: "lead", cursor: cursorOf(first) });

    expect(names(first)).toHaveLength(25);
    expect(names(second)).toHaveLength(11);
    expect(dataCalls(hyphabase.calls)[1].query).toMatchObject({ "filter[name][contains]": "customer", "filter[status]": "lead", cursor: cursorOf(first) });
  });

  it("says nobody matches with an empty page, not an error", async () => {
    const { crm, session } = await signedIn("marcus");

    expect(await crm.listCustomers(session, { q: "zzz" })).toEqual({ status: 200, body: { data: [], next_cursor: null } });
  });

  it.each([{ status: "archived" }, { status: "" }, { q: "" }, { q: "   " }, { status: ["active"] }, { q: 7 }])("ignores a filter it does not offer (%j)", async (query) => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect((await crm.listCustomers(session, query)).status).toBe(200);
    expect(dataCalls(hyphabase.calls)[0].query).toEqual({ sort: "-created_at", limit: "25" });
  });

  it("passes on nothing but the search, the status and the cursor: no field, operator, sort or page size from the browser", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    const reply = await crm.listCustomers(session, { q: "dana", limit: "100", sort: "email", include_deleted: "true", select: "email", filter: { email: { contains: "@" } }, "filter[email][contains]": "@" });

    expect(reply.status).toBe(200);
    expect(dataCalls(hyphabase.calls)[0].query).toEqual({ "filter[name][contains]": "dana", sort: "-created_at", limit: "25" });
  });

  it("treats what was typed as text to look for, never as part of the query", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");
    const typed = "%_&filter[status]=active&limit=100";

    const reply = await crm.listCustomers(session, { q: typed });

    expect(reply).toEqual({ status: 200, body: { data: [], next_cursor: null } });
    expect(dataCalls(hyphabase.calls)[0].query).toEqual({ "filter[name][contains]": typed, sort: "-created_at", limit: "25" });
  });

  it("looks for the first 100 characters of a very long search", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    await crm.listCustomers(session, { q: "a".repeat(500) });

    expect(dataCalls(hyphabase.calls)[0].query["filter[name][contains]"]).toBe("a".repeat(100));
  });

  it.each(["not a cursor!", "<script>", "a".repeat(600), 12, ["abc"]])("refuses a cursor that cannot be one, without asking HyphaBase (%j)", async (cursor) => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect(await crm.listCustomers(session, { cursor })).toEqual({ status: 422, body: { error: "That page is not available any more. Start the list again." } });
    expect(dataCalls(hyphabase.calls)).toEqual([]);
  });

  it("says the same when HyphaBase does not recognise the cursor", async () => {
    const { crm, session, log } = await signedIn("marcus");

    expect(await crm.listCustomers(session, { cursor: btoa(JSON.stringify({ id: "nobody" })) })).toEqual({
      status: 422,
      body: { error: "That page is not available any more. Start the list again." },
    });
    expect(log.at(-1)).toBe("list customers 422");
  });
});

describe("adding a customer", () => {
  it("is refused for staff, and nothing is written", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    const reply = await crm.addCustomer(session, LIAM);

    expect(reply).toEqual({ status: 403, body: { error: "Your role does not allow this.", required_permission: "data.records.create" } });
    expect(hyphabase.records).toHaveLength(1);
  });

  it("works for the owner and returns the new record", async () => {
    const { crm, session, hyphabase, log } = await signedIn("sarah");

    const reply = await crm.addCustomer(session, LIAM);

    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ data: { ...LIAM } });
    expect(hyphabase.records[0]).toMatchObject(LIAM);
    expect(log.some((line) => line.startsWith("sarah@brightsideclean.example added customer "))).toBe(true);
  });

  it("sends only the four customer fields on, whatever else the browser adds", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    await crm.addCustomer(session, { ...LIAM, id: "chosen-by-the-browser", owner_id: "u-marcus", location_id: SALEM });

    expect(hyphabase.calls.at(-1)?.body).toEqual(LIAM);
  });

  it("tidies the input and leaves the status to the collection's default", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    await crm.addCustomer(session, { name: "  Liam Ortiz ", email: " Liam.Ortiz@Example.com ", phone: "" });

    expect(hyphabase.calls.at(-1)?.body).toEqual({ name: "Liam Ortiz", email: "liam.ortiz@example.com" });
  });

  it.each([
    [{}, { name: "Enter a name.", email: "Enter an email address." }],
    [{ name: "Liam", email: "not-an-email" }, { email: "Enter a valid email address." }],
    [{ name: "x".repeat(201), email: "liam@example.com" }, { name: "Keep the name under 200 characters." }],
    [{ name: "Liam", email: "liam@example.com", phone: "5".repeat(51) }, { phone: "Keep the phone number under 50 characters." }],
    [{ name: "Liam", email: "liam@example.com", status: "vip" }, { status: "Choose lead, active or inactive." }],
    [{ name: ["Liam"], email: { $ne: "" } }, { name: "Enter a name.", email: "Enter an email address." }],
    ["not an object", { name: "Enter a name.", email: "Enter an email address." }],
  ])("refuses input that is not a customer (%j)", async (body, errors) => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    expect(await crm.addCustomer(session, body)).toEqual({ status: 422, body: { error: "Check the highlighted fields.", errors } });
    expect(dataCalls(hyphabase.calls)).toEqual([]);
  });

  it("checks the role before the input, so staff learn nothing from validation", async () => {
    const { crm, session } = await signedIn("marcus");

    expect((await crm.addCustomer(session, {})).status).toBe(403);
  });

  it("says so when the email is already taken", async () => {
    const { crm, session } = await signedIn("sarah");

    expect(await crm.addCustomer(session, { name: "Dana Again", email: "dana@example.com" })).toEqual({
      status: 409,
      body: { error: "A customer with that email already exists.", errors: { email: "A customer with that email already exists." } },
    });
  });
});

describe("editing a customer", () => {
  const dana = { id: DANA, name: "Dana Whitfield", email: "dana@example.com", phone: "555-0142", status: "lead" };

  it("is refused for someone who can only read, and nothing is changed", async () => {
    const reader = { ...people.marcus(), permissions: ["data.records.read"] };
    const { crm, session, hyphabase } = await signedIn("marcus", [reader]);

    const reply = await crm.updateCustomer(session, DANA, { phone: "555-0143" });

    expect(reply).toEqual({ status: 403, body: { error: "Your role does not allow this.", required_permission: "data.records.update" } });
    expect(hyphabase.records[0]).toEqual(dana);
    expect(dataCalls(hyphabase.calls)).toEqual([]);
  });

  it("works for staff, and changes only the field that was sent", async () => {
    const { crm, session, hyphabase, log } = await signedIn("marcus");

    const reply = await crm.updateCustomer(session, DANA, { phone: "555-0143" });

    expect(reply).toEqual({ status: 200, body: { data: { ...dana, phone: "555-0143" } } });
    expect(hyphabase.calls.at(-1)).toMatchObject({ method: "PATCH", path: `/api/modules/data/customers/records/${DANA}`, bearer: SECRET_KEY, body: { phone: "555-0143" } });
    expect(hyphabase.calls.at(-1)?.body).toEqual({ phone: "555-0143" });
    expect(log).toContain(`marcus@brightsideclean.example updated customer ${DANA}`);
  });

  it("works for the owner, with every field at once", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    const reply = await crm.updateCustomer(session, DANA, { name: " Dana Whitfield-Ross ", email: " Dana.Ross@Example.com ", phone: "555-0150", status: "active" });

    const changed = { name: "Dana Whitfield-Ross", email: "dana.ross@example.com", phone: "555-0150", status: "active" };
    expect(reply).toEqual({ status: 200, body: { data: { id: DANA, ...changed } } });
    expect(hyphabase.records[0]).toEqual({ id: DANA, ...changed });
  });

  it.each(["", "   ", null])("clears the phone number when it is sent empty (%j)", async (phone) => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    const reply = await crm.updateCustomer(session, DANA, { phone });

    expect(reply.body).toEqual({ data: { ...dana, phone: null } });
    expect(hyphabase.calls.at(-1)?.body).toEqual({ phone: null });
  });

  it("sends only the four customer fields on, whatever else the browser adds", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    await crm.updateCustomer(session, DANA, { status: "active", id: "another-id", owner_id: "u-marcus", deleted_at: "2020-01-01" });

    expect(hyphabase.calls.at(-1)?.body).toEqual({ status: "active" });
  });

  it.each([
    [{ name: "" }, { name: "Enter a name." }],
    [{ name: "x".repeat(201) }, { name: "Keep the name under 200 characters." }],
    [{ email: "" }, { email: "Enter an email address." }],
    [{ email: "not-an-email" }, { email: "Enter a valid email address." }],
    [{ phone: "5".repeat(51) }, { phone: "Keep the phone number under 50 characters." }],
    [{ status: "vip" }, { status: "Choose lead, active or inactive." }],
    [{ status: "" }, { status: "Choose lead, active or inactive." }],
    [{ name: null, email: { $ne: "" } }, { name: "Enter a name.", email: "Enter an email address." }],
  ])("refuses a change that would leave a bad customer (%j)", async (body, errors) => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    expect(await crm.updateCustomer(session, DANA, body)).toEqual({ status: 422, body: { error: "Check the highlighted fields.", errors } });
    expect(dataCalls(hyphabase.calls)).toEqual([]);
  });

  it.each([{}, { nickname: "D" }, "not an object", undefined])("refuses a request that changes nothing (%j)", async (body) => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    expect(await crm.updateCustomer(session, DANA, body)).toEqual({ status: 422, body: { error: "Send at least one field to change." } });
    expect(dataCalls(hyphabase.calls)).toEqual([]);
  });

  it("checks the role before the input", async () => {
    const reader = { ...people.marcus(), permissions: ["data.records.read"] };
    const { crm, session } = await signedIn("marcus", [reader]);

    expect((await crm.updateCustomer(session, DANA, {})).status).toBe(403);
  });

  it("says so when the new email belongs to another customer", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");
    await crm.addCustomer(session, LIAM);

    expect(await crm.updateCustomer(session, DANA, { email: LIAM.email })).toEqual({
      status: 409,
      body: { error: "A customer with that email already exists.", errors: { email: "A customer with that email already exists." } },
    });
    expect(hyphabase.records.find((r) => r.id === DANA)).toEqual(dana);
  });

  it("answers 404 for a customer that is not there", async () => {
    const { crm, session } = await signedIn("marcus");

    expect(await crm.updateCustomer(session, "c0000000-0000-4000-8000-00000000ffff", { phone: "555-0143" })).toEqual({ status: 404, body: { error: "No such customer." } });
  });

  it("answers 404 for an id that cannot be a customer, without asking HyphaBase", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect((await crm.updateCustomer(session, "../collections", { phone: "555-0143" })).status).toBe(404);
    expect(dataCalls(hyphabase.calls)).toEqual([]);
  });

  it("is refused with no session before anything else", async () => {
    const { crm, hyphabase } = setup();

    expect((await crm.updateCustomer(memoryStorage(), DANA, { phone: "555-0143" })).status).toBe(401);
    expect(hyphabase.calls).toHaveLength(0);
  });
});

describe("deleting a customer", () => {
  it("is refused for staff, who can edit but not delete, and the customer is still there", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect(await crm.deleteCustomer(session, DANA)).toEqual({ status: 403, body: { error: "Your role does not allow this.", required_permission: "data.records.delete" } });
    expect(hyphabase.records).toHaveLength(1);
    expect(dataCalls(hyphabase.calls)).toEqual([]);
  });

  it("works for the owner", async () => {
    const { crm, session, hyphabase, log } = await signedIn("sarah");

    expect(await crm.deleteCustomer(session, DANA)).toEqual({ status: 204 });
    expect(hyphabase.records).toHaveLength(0);
    expect(log).toContain(`sarah@brightsideclean.example deleted customer ${DANA}`);
  });

  it("answers 404 for a customer that is not there", async () => {
    const { crm, session } = await signedIn("sarah");

    expect(await crm.deleteCustomer(session, "c0000000-0000-4000-8000-00000000ffff")).toEqual({ status: 404, body: { error: "No such customer." } });
  });

  it("answers 404 for an id that cannot be a customer, without asking HyphaBase", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    expect((await crm.deleteCustomer(session, "../collections")).status).toBe(404);
    expect(dataCalls(hyphabase.calls)).toEqual([]);
  });
});

describe("signing out", () => {
  it("revokes the token at HyphaBase and forgets the session", async () => {
    const { crm, session, hyphabase } = await signedIn("sarah");

    expect(await crm.signOut(session)).toEqual({ status: 204 });
    expect(session.get()).toBeNull();
    expect(hyphabase.calls.at(-1)).toMatchObject({ path: "/api/auth/logout", bearer: "token-1" });

    session.set({ accessToken: "token-1", refreshToken: "gone", expiresAt: new Date(Date.now() + 60_000).toISOString(), user: { id: "", name: "", email: "" }, locationIds: [] });
    expect((await crm.listCustomers(session)).status).toBe(401);
  });

  it("is fine when nobody is signed in", async () => {
    const { crm } = setup();

    expect(await crm.signOut(memoryStorage())).toEqual({ status: 204 });
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
      fetch: async () => {
        throw new Error("connect ECONNREFUSED 10.1.2.3:443");
      },
      log: (line) => log.push(line),
    });

    const reply = await crm.signIn(memoryStorage(), { email: "sarah@brightsideclean.example", password: "correct-password" });

    expect(reply).toEqual({ status: 502, body: { error: "The CRM could not reach its backend." } });
    expect(log.join("\n")).toContain("ECONNREFUSED");
  });
});

describe("configuration", () => {
  const config = { apiUrl: "https://api.test", secretKey: SECRET_KEY, publishableKey: PUBLISHABLE_KEY, locationId: PORTLAND };

  it("refuses to start with the keys swapped or missing", () => {
    expect(() => createCrm({ ...config, publishableKey: SECRET_KEY })).toThrow(/HYPHABASE_PUBLISHABLE_KEY/);
    expect(() => createCrm({ ...config, secretKey: PUBLISHABLE_KEY })).toThrow(/HYPHABASE_SECRET_KEY/);
    expect(() => createCrm({ ...config, locationId: "" })).toThrow(/HYPHABASE_LOCATION_ID/);
    expect(() => createCrm({ ...config, apiUrl: "" })).toThrow(/HYPHABASE_API_URL/);
  });
});
