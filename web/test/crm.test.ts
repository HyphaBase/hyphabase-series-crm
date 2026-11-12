import { memoryStorage, type Session } from "hyphabase";
import { describe, expect, it } from "vitest";
import { createCrm } from "../lib/crm";
import { fakeHyphaBase, people, PORTLAND, PUBLISHABLE_KEY, SALEM, SECRET_KEY, type FakeUser } from "./fake-hyphabase";

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
const dataCalls = (calls: { path: string }[]) => calls.filter((call) => call.path.includes("/modules/data/"));

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
      body: { user: { id: "u-marcus", name: "Marcus Bell", email: "marcus@brightsideclean.example" }, permissions: ["data.records.read"] },
    });
    expect(hyphabase.calls.every((call) => call.bearer === "token-1" && call.location === PORTLAND)).toBe(true);
  });

  it("does not trust the name stored in the session", async () => {
    const { crm, session } = await signedIn("marcus");
    session.set({ ...(session.get() as Session), user: { id: "u-sarah", name: "Sarah Mitchell", email: "sarah@brightsideclean.example" } });

    const reply = await crm.me(session);

    expect(reply.body).toMatchObject({ user: { name: "Marcus Bell" }, permissions: ["data.records.read"] });
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
    expect(reply.body).toEqual({ data: [{ id: DANA, name: "Dana Whitfield", email: "dana@example.com", phone: "555-0142", status: "lead" }] });
    expect(hyphabase.calls.map((call) => [call.path, call.bearer])).toEqual([
      ["/api/auth/me", "token-1"],
      ["/api/permissions/me", "token-1"],
      ["/api/modules/data/customers/records", SECRET_KEY],
    ]);
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

describe("deleting a customer", () => {
  it("is refused for staff, and the customer is still there", async () => {
    const { crm, session, hyphabase } = await signedIn("marcus");

    expect((await crm.deleteCustomer(session, DANA)).status).toBe(403);
    expect(hyphabase.records).toHaveLength(1);
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
