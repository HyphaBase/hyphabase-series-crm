/**
 * The CRM's own server. It is the only place the secret key lives.
 *
 * People sign in here and get a token. Every other request has to carry
 * that token, and the server asks HyphaBase who it belongs to before it
 * touches any customer data.
 *
 *   POST /login      { email, password }  ->  { token, expires_at, user }
 *   GET  /me         who am I
 *   GET  /customers  the customer list
 *   POST /logout     revoke the token
 *
 * Plain node:http, no framework, so nothing is hidden.
 */

import { currentUser, signIn, signOut } from "./auth.js";
import { listCustomers } from "./customers.js";
import { ApiError } from "./hyphabase.js";

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
      if (user) send(res, 200, { user: { id: user.id, name: user.name, email: user.email } });
    },

    "GET /customers": async (req, res) => {
      const user = await requireUser(req, res);
      if (user) send(res, 200, { data: await listCustomers(api) });
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
    const name = `${req.method} ${new URL(req.url, "http://localhost").pathname}`;
    try {
      const route = routes[name];
      if (route) await route(req, res);
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
