/**
 * The CRM's own server. It is the only place the secret key lives.
 *
 * People sign in here and get a token. Every other request has to carry
 * that token, and before the server touches any customer data it asks
 * HyphaBase two things: who the token belongs to, and what that person's
 * role allows.
 *
 *   POST   /login          { email, password }  ->  { token, expires_at, user }
 *   GET    /me             who am I, and what may I do
 *   GET    /customers      the customer list         needs data.records.read
 *   DELETE /customers/:id  delete a customer         needs data.records.delete
 *   POST   /logout         revoke the token
 *
 * Plain node:http, no framework, so nothing is hidden.
 */

import { currentUser, signIn, signOut } from "./auth.js";
import { deleteCustomer, listCustomers } from "./customers.js";
import { ApiError } from "./hyphabase.js";
import { CAN, permissionsOf } from "./roles.js";

// Record ids are UUIDs. Anything else cannot be a customer, so HyphaBase is not asked.
const CUSTOMER_PATH = /^\/customers\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

export function createApp({ api, locationId, log = () => {} }) {
  /** The signed-in user, or a 401 response and null. */
  async function requireUser(req, res) {
    const token = bearerToken(req);
    if (!token) {
      send(res, 401, { error: "Sign in first." });
      return null;
    }

    const user = await currentUser(api, locationId, token);
    if (!user) send(res, 401, { error: "Your session is not valid. Sign in again." });
    return user;
  }

  /**
   * The signed-in user, if their role carries the permission. Otherwise a
   * response (401 not signed in, 403 signed in but not allowed) and null.
   */
  async function requirePermission(req, res, permission) {
    const user = await requireUser(req, res);
    if (!user) return null;

    const permissions = await permissionsOf(api, locationId, bearerToken(req));
    if (permissions.includes(permission)) return user;

    log(`${user.email} was refused: no ${permission}`);
    send(res, 403, { error: "Your role does not allow this.", required_permission: permission });
    return null;
  }

  const routes = {
    "POST /login": async (req, res) => {
      const { email, password } = await readJson(req);
      if (!email || !password) return send(res, 400, { error: "Send an email and a password." });

      try {
        const { token, expires_at, user } = await signIn(api, { email, password });
        send(res, 200, { token, expires_at, user });
      } catch (error) {
        if (error instanceof ApiError && error.status === 422) return send(res, 401, { error: "Wrong email or password." });
        if (error instanceof ApiError && error.status === 429) return send(res, 429, { error: "Too many attempts. Wait a minute and try again." });
        throw error;
      }
    },

    "GET /me": async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;

      const permissions = await permissionsOf(api, locationId, bearerToken(req));
      send(res, 200, { user: { id: user.id, name: user.name, email: user.email }, permissions });
    },

    "GET /customers": async (req, res) => {
      const user = await requirePermission(req, res, CAN.readCustomers);
      if (user) send(res, 200, { data: await listCustomers(api) });
    },

    "DELETE /customers/:id": async (req, res, id) => {
      const user = await requirePermission(req, res, CAN.deleteCustomers);
      if (!user) return;

      try {
        await deleteCustomer(api, id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return send(res, 404, { error: "No such customer." });
        throw error;
      }
      log(`${user.email} deleted customer ${id}`);
      send(res, 204);
    },

    "POST /logout": async (req, res) => {
      const token = bearerToken(req);
      if (!token) return send(res, 401, { error: "Sign in first." });

      try {
        await signOut(api, locationId, token);
      } catch (error) {
        // Already signed out or expired: the result is the same.
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
      send(res, 204);
    },
  };

  return async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    const customerId = pathname.match(CUSTOMER_PATH)?.[1];
    const name = `${req.method} ${customerId ? "/customers/:id" : pathname}`;
    try {
      const route = routes[name];
      if (route) await route(req, res, customerId);
      else send(res, 404, { error: "Not found." });
    } catch (error) {
      // The reason stays in the server's log. Callers only learn that it failed.
      log(`${name} failed: ${error.message}`);
      send(res, error instanceof BadRequest ? 400 : 502, { error: error instanceof BadRequest ? error.message : "The CRM could not reach its backend." });
    }
    log(`${name} ${res.statusCode}`);
  };
}

class BadRequest extends Error {}

function bearerToken(req) {
  return req.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? null;
}

async function readJson(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 10_000) throw new BadRequest("Request body is too large.");
  }
  try {
    return JSON.parse(text || "{}") ?? {};
  } catch {
    throw new BadRequest("Send a JSON body.");
  }
}

function send(res, status, body) {
  res.writeHead(status, body === undefined ? {} : { "Content-Type": "application/json" });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}
