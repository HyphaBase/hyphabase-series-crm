/**
 * The CRM's server side. It is the only place the secret key is used.
 *
 * It does what the small server from episodes 3 and 4 did (src/server.js),
 * now through the HyphaBase SDK instead of hand-written requests:
 *
 *   signIn          email + password  ->  a session, kept by the caller
 *   me              who am I, and what may I do
 *   listCustomers   needs clients.view; one page, searched and filtered by HyphaBase
 *   addCustomer     needs clients.create
 *   updateCustomer  needs clients.update
 *   deleteCustomer  needs clients.delete
 *   listNotes       needs clients.view
 *   addNote         needs clients.update; sent as the person, so HyphaBase records who wrote it
 *   signOut         revoke the session
 *
 * Since episode 8 the customers live in HyphaBase's Clients module, not in
 * a collection of our own. The CRM still calls them customers.
 *
 * Nothing in this file knows about Next.js. Each function takes the place
 * the session is kept and plain input, and returns a status and a body.
 * The files under app/api/ are the thin layer that connects them to HTTP.
 */

import { createClient, HyphaBaseError, memoryStorage, type ClientNote, type Paginated, type SessionStorageAdapter } from "hyphabase";
import { PAGE_SIZE, parseCustomer, parseCustomerChanges, parseListQuery, parseNote, STATUSES, toCustomer, type ClientRecord, type Note, type Status } from "./customers";
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

// Client ids are UUIDs. Anything else cannot be a customer, so HyphaBase is not asked.
const CUSTOMER_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** A request that ends here, with the answer to send. */
class Refusal extends Error {
  constructor(readonly reply: Reply) {
    super(`Refused with ${reply.status}`);
  }
}

const refuse = (status: number, body: Record<string, unknown>) => new Refusal({ status, body });

const noSuchCustomer = () => refuse(404, { error: "No such customer." });

/** A page number that cannot be one. */
const noSuchPage = () => refuse(422, { error: "That page is not available any more. Start the list again." });

/** HyphaBase refusing a client because its email is taken: two clients cannot share one. */
function emailTaken(error: unknown): Refusal | null {
  if (!(error instanceof HyphaBaseError && error.status === 422 && error.body?.errors?.email)) return null;
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
  const server = createClient(apiUrl, secretKey, { locationId, storage: memoryStorage(), fetch: config.fetch });
  const clients = server.clients;

  /** A customer as the browser sees it, with the status it has at our location. */
  const shown = (client: unknown) => toCustomer(client as ClientRecord, locationId);

  /**
   * The module knows a status by its id; the CRM says lead, active or
   * inactive. The ids are looked up once and kept. If a status is missing,
   * nothing is kept, so running the setup script is enough to recover.
   */
  let statusIds: Promise<Record<Status, string>> | undefined;
  const statusId = async (status: Status): Promise<string> => {
    statusIds ??= clients.statuses.list().then(({ data }) => {
      const ids = Object.fromEntries(data.map((entry) => [entry.name.toLowerCase(), entry.id]));
      if (!STATUSES.every((name) => ids[name])) throw refuse(503, { error: "The CRM is not set up yet. Run: npm run clients:setup" });
      return ids as Record<Status, string>;
    });
    try {
      return (await statusIds)[status];
    } catch (error) {
      statusIds = undefined;
      throw error;
    }
  };

  /** A note as the browser sees it. The author is whoever HyphaBase recorded, not whoever the browser says. */
  const toNote = (note: ClientNote): Note => ({
    id: note.id,
    content: note.content,
    author: (note.user as { name?: string } | null | undefined)?.name ?? null,
    created_at: note.created_at,
  });

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
        const { q, status, page } = parsed.query;

        // The parameter names, the order and the page size are written here. The browser supplies two values and a page number.
        const query = new URLSearchParams();
        if (q) query.set("search", q);
        if (status) query.set("client_status_id", await statusId(status));
        query.set("sort_by", "created_at");
        query.set("sort_direction", "desc");
        query.set("per_page", String(PAGE_SIZE));
        query.set("page", String(page));

        const { data, meta } = await server.request<Paginated<ClientRecord>>(`/api/modules/clients?${query}`);
        return { status: 200, body: { data: data.map(shown), next_page: meta.current_page < meta.last_page ? meta.current_page + 1 : null, total: meta.total } };
      }),

    addCustomer: (session: SessionStorageAdapter, input: unknown) =>
      answer("add customer", async () => {
        const user = await requirePermission(session, CAN.addCustomers);

        const parsed = parseCustomer(input);
        if (!parsed.ok) throw refuse(422, { error: "Check the highlighted fields.", errors: parsed.errors });

        const { status = "lead", ...fields } = parsed.customer;
        const status_id = await statusId(status);

        let client;
        try {
          client = await clients.create(fields);
        } catch (error) {
          throw emailTaken(error) ?? error;
        }
        // The status is kept beside the client, one per location, so it is a second request.
        await clients.locationStatuses(client.id).assign(locationId, status_id);

        log(`${user.email} added customer ${client.id}`);
        return { status: 201, body: { data: { ...shown(client), status } } };
      }),

    updateCustomer: (session: SessionStorageAdapter, id: string, input: unknown) =>
      answer("update customer", async () => {
        const user = await requirePermission(session, CAN.updateCustomers);
        if (!CUSTOMER_ID.test(id)) throw noSuchCustomer();

        const parsed = parseCustomerChanges(input);
        if (!parsed.ok) throw refuse(422, { error: "Check the highlighted fields.", errors: parsed.errors });
        if (Object.keys(parsed.changes).length === 0) throw refuse(422, { error: "Send at least one field to change." });

        const { status, ...fields } = parsed.changes;
        const status_id = status && (await statusId(status));

        let client;
        try {
          client = Object.keys(fields).length > 0 ? await clients.update(id, fields) : await clients.get(id);
        } catch (error) {
          if (error instanceof HyphaBaseError && error.status === 404) throw noSuchCustomer();
          throw emailTaken(error) ?? error;
        }
        if (status_id) await clients.locationStatuses(id).assign(locationId, status_id);

        log(`${user.email} updated customer ${id}`);
        return { status: 200, body: { data: { ...shown(client), ...(status ? { status } : {}) } } };
      }),

    /** The Clients module archives a deleted client and keeps it for 30 days, so a mistake can be undone at HyphaBase. */
    deleteCustomer: (session: SessionStorageAdapter, id: string) =>
      answer("delete customer", async () => {
        const user = await requirePermission(session, CAN.deleteCustomers);
        if (!CUSTOMER_ID.test(id)) throw noSuchCustomer();

        try {
          await clients.delete(id);
        } catch (error) {
          // 409 is HyphaBase saying the client is already archived. To the CRM that customer is gone.
          if (error instanceof HyphaBaseError && (error.status === 404 || error.status === 409)) throw noSuchCustomer();
          throw error;
        }
        log(`${user.email} deleted customer ${id}`);
        return { status: 204 };
      }),

    /**
     * Notes are the one thing the CRM sends as the person and not as the
     * server. HyphaBase checks their role again and, on a new note, records
     * them as its author: a name the browser cannot choose.
     */
    listNotes: (session: SessionStorageAdapter, id: string) =>
      answer("list notes", async () => {
        await requirePermission(session, CAN.readCustomers);
        if (!CUSTOMER_ID.test(id)) throw noSuchCustomer();

        try {
          const { data } = await actingAs(session).clients.notes(id).list();
          return { status: 200, body: { data: data.map(toNote) } };
        } catch (error) {
          if (error instanceof HyphaBaseError && error.status === 404) throw noSuchCustomer();
          throw error;
        }
      }),

    addNote: (session: SessionStorageAdapter, id: string, input: unknown) =>
      answer("add note", async () => {
        const user = await requirePermission(session, CAN.updateCustomers);
        if (!CUSTOMER_ID.test(id)) throw noSuchCustomer();

        const parsed = parseNote(input);
        if (!parsed.ok) throw refuse(422, { error: parsed.error });

        let note: ClientNote;
        try {
          // "internal" keeps a note among the people who work here. The category is the module's way to group notes; the CRM uses one.
          note = await actingAs(session).clients.notes(id).create({
            category: "General",
            content: parsed.content,
            visibility: "internal",
          });
        } catch (error) {
          if (error instanceof HyphaBaseError && error.status === 404) throw noSuchCustomer();
          throw error;
        }
        log(`${user.email} added a note to customer ${id}`);
        return { status: 201, body: { data: toNote(note) } };
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
