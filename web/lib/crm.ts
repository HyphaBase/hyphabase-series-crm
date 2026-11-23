/**
 * The CRM's server side. It is the only place the secret key is used.
 *
 * It does what the small server from episodes 3 and 4 did (src/server.js),
 * now through the HyphaBase SDK instead of hand-written requests:
 *
 *   signIn          email + password  ->  a session, kept by the caller
 *   me              who am I, and what may I do
 *   listCustomers   needs data.records.read; one page, searched and filtered by HyphaBase
 *   addCustomer     needs data.records.create
 *   updateCustomer  needs data.records.update
 *   deleteCustomer  needs data.records.delete
 *   signOut         revoke the session
 *
 * Nothing in this file knows about Next.js. Each function takes the place
 * the session is kept and plain input, and returns a status and a body.
 * The files under app/api/ are the thin layer that connects them to HTTP.
 */

import { createClient, HyphaBaseError, memoryStorage, type SessionStorageAdapter } from "hyphabase";
import { PAGE_SIZE, parseCustomer, parseCustomerChanges, parseListQuery, toCustomer, type Customer, type CustomerFields } from "./customers";
import { CAN, type Permission } from "./permissions";

export { CAN };

export interface CrmConfig {
  apiUrl: string;
  secretKey: string;
  publishableKey: string;
  locationId: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface Reply {
  status: number;
  body?: unknown;
}

export interface Person {
  id: string;
  name: string;
  email: string;
}

// Record ids are UUIDs. Anything else cannot be a customer, so HyphaBase is not asked.
const CUSTOMER_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** A request that ends here, with the answer to send. */
class Refusal extends Error {
  constructor(readonly reply: Reply) {
    super(`Refused with ${reply.status}`);
  }
}

const refuse = (status: number, body: Record<string, unknown>) => new Refusal({ status, body });

const noSuchCustomer = () => refuse(404, { error: "No such customer." });

/** A cursor HyphaBase did not hand out. */
const noSuchPage = () => refuse(422, { error: "That page is not available any more. Start the list again." });

/** HyphaBase refusing a record because its email is taken: the collection's only unique field. */
function emailTaken(error: unknown): Refusal | null {
  if (!(error instanceof HyphaBaseError && error.status === 422 && error.body?.errors?.record)) return null;
  const taken = "A customer with that email already exists.";
  return refuse(409, { error: taken, errors: { email: taken } });
}

export function createCrm(config: CrmConfig) {
  const { apiUrl, secretKey, publishableKey, locationId, log = () => {} } = config;
  if (!apiUrl) throw new Error("Set HYPHABASE_API_URL.");
  if (!secretKey?.startsWith("sk_")) throw new Error("Set HYPHABASE_SECRET_KEY to a secret key (it starts with sk_).");
  if (!publishableKey?.startsWith("pk_")) throw new Error("Set HYPHABASE_PUBLISHABLE_KEY to a publishable key (it starts with pk_).");
  if (!locationId) throw new Error("Set HYPHABASE_LOCATION_ID.");

  // The server itself. This client holds the secret key and never signs anyone in.
  const server = createClient(apiUrl, secretKey, { storage: memoryStorage(), fetch: config.fetch });
  const customers = server.data.collection<CustomerFields>("customers");

  /**
   * One person. This client holds the publishable key, which can read
   * nothing on its own, so without a session HyphaBase accepts it has no
   * way to act. It must never be given the secret key: the SDK falls back
   * to a secret key when a session runs out, and the request would then
   * go out as the server.
   */
  const actingAs = (session: SessionStorageAdapter) =>
    createClient(apiUrl, publishableKey, { locationId, storage: session, fetch: config.fetch });

  /** Who the session belongs to and what their roles allow, both asked of HyphaBase. */
  async function identify(session: SessionStorageAdapter): Promise<{ user: Person; permissions: string[] }> {
    if (!session.get()) throw refuse(401, { error: "Sign in first." });

    const person = actingAs(session);
    try {
      const { user } = await person.profile.get();
      const { permissions } = await person.profile.permissions();
      return { user: { id: user.id, name: user.name, email: user.email }, permissions };
    } catch (error) {
      if (error instanceof HyphaBaseError && error.status === 401) {
        session.clear();
        throw refuse(401, { error: "Your session is not valid. Sign in again." });
      }
      if (error instanceof HyphaBaseError && error.status === 403) {
        throw refuse(403, { error: "Your account does not belong to this location." });
      }
      throw error;
    }
  }

  /** The signed-in person, if their role carries the permission. Otherwise the request ends with 401 or 403. */
  async function requirePermission(session: SessionStorageAdapter, permission: Permission): Promise<Person> {
    const { user, permissions } = await identify(session);
    if (permissions.includes(permission)) return user;

    log(`${user.email} was refused: no ${permission}`);
    throw refuse(403, { error: "Your role does not allow this.", required_permission: permission });
  }

  /** Runs one request and turns anything unexpected into a 502. The reason stays in the server's log. */
  async function answer(name: string, work: () => Promise<Reply>): Promise<Reply> {
    let reply: Reply;
    try {
      reply = await work();
    } catch (error) {
      if (error instanceof Refusal) {
        reply = error.reply;
      } else {
        log(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
        reply = { status: 502, body: { error: "The CRM could not reach its backend." } };
      }
    }
    log(`${name} ${reply.status}`);
    return reply;
  }

  return {
    signIn: (session: SessionStorageAdapter, input: unknown) =>
      answer("sign in", async () => {
        const { email, password } = (input ?? {}) as Record<string, unknown>;
        if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
          throw refuse(400, { error: "Send an email and a password." });
        }

        const person = actingAs(session);
        try {
          const { user, locationIds } = await person.auth.signIn({ email, password });
          if (!locationIds.includes(locationId)) {
            await person.auth.signOut();
            throw refuse(403, { error: "Your account does not belong to this location." });
          }
          return { status: 200, body: { user: { id: user.id, name: user.name, email: user.email } } };
        } catch (error) {
          if (error instanceof HyphaBaseError && error.status === 422) throw refuse(401, { error: "Wrong email or password." });
          if (error instanceof HyphaBaseError && error.status === 429) throw refuse(429, { error: "Too many attempts. Wait a minute and try again." });
          throw error;
        }
      }),

    me: (session: SessionStorageAdapter) =>
      answer("who am I", async () => ({ status: 200, body: await identify(session) })),

    listCustomers: (session: SessionStorageAdapter, input?: unknown) =>
      answer("list customers", async () => {
        await requirePermission(session, CAN.readCustomers);

        const parsed = parseListQuery(input);
        if (!parsed.ok) throw noSuchPage();
        const { q, status, cursor } = parsed.query;

        // The field names, the operators, the order and the page size are written here. The browser supplies two values and a cursor.
        const filter = { ...(q ? { name: { contains: q } } : {}), ...(status ? { status } : {}) };
        try {
          const page = await customers.list({ filter, sort: "-created_at", limit: PAGE_SIZE, cursor });
          return { status: 200, body: { data: page.data.map(toCustomer), next_cursor: page.meta.next_cursor } };
        } catch (error) {
          if (error instanceof HyphaBaseError && error.status === 422 && error.body?.errors?.cursor) throw noSuchPage();
          throw error;
        }
      }),

    addCustomer: (session: SessionStorageAdapter, input: unknown) =>
      answer("add customer", async () => {
        const user = await requirePermission(session, CAN.addCustomers);

        const parsed = parseCustomer(input);
        if (!parsed.ok) throw refuse(422, { error: "Check the highlighted fields.", errors: parsed.errors });

        let customer: Customer;
        try {
          customer = toCustomer((await customers.create(parsed.customer)).data);
        } catch (error) {
          throw emailTaken(error) ?? error;
        }
        log(`${user.email} added customer ${customer.id}`);
        return { status: 201, body: { data: customer } };
      }),

    updateCustomer: (session: SessionStorageAdapter, id: string, input: unknown) =>
      answer("update customer", async () => {
        const user = await requirePermission(session, CAN.updateCustomers);
        if (!CUSTOMER_ID.test(id)) throw noSuchCustomer();

        const parsed = parseCustomerChanges(input);
        if (!parsed.ok) throw refuse(422, { error: "Check the highlighted fields.", errors: parsed.errors });
        if (Object.keys(parsed.changes).length === 0) throw refuse(422, { error: "Send at least one field to change." });

        let customer: Customer;
        try {
          customer = toCustomer((await customers.update(id, parsed.changes)).data);
        } catch (error) {
          if (error instanceof HyphaBaseError && error.status === 404) throw noSuchCustomer();
          throw emailTaken(error) ?? error;
        }
        log(`${user.email} updated customer ${id}`);
        return { status: 200, body: { data: customer } };
      }),

    deleteCustomer: (session: SessionStorageAdapter, id: string) =>
      answer("delete customer", async () => {
        const user = await requirePermission(session, CAN.deleteCustomers);
        if (!CUSTOMER_ID.test(id)) throw noSuchCustomer();

        try {
          await customers.delete(id);
        } catch (error) {
          if (error instanceof HyphaBaseError && error.status === 404) throw noSuchCustomer();
          throw error;
        }
        log(`${user.email} deleted customer ${id}`);
        return { status: 204 };
      }),

    signOut: (session: SessionStorageAdapter) =>
      answer("sign out", async () => {
        // Revokes the token at HyphaBase, then forgets it here.
        await actingAs(session).auth.signOut();
        return { status: 204 };
      }),
  };
}

export type Crm = ReturnType<typeof createCrm>;
