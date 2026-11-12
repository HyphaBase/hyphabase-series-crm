/**
 * Who is using the CRM: users, sign-in and sign-out.
 *
 * HyphaBase stores the users, checks the passwords and issues the tokens.
 * There is no users table, password hashing or session store in this repo.
 */

import { ApiError } from "./hyphabase.js";

/** Creates a user who can sign in at a location. Needs the `users.create` scope. */
export async function addUser(api, locationId, { name, email, password }) {
  const { data } = await api.request("/api/modules/employees/users", {
    method: "POST",
    locationId,
    body: { name, email, password },
  });
  return data;
}

/** Trades an email and password for a token. Throws a 422 ApiError if they are wrong. */
export function signIn(api, { email, password }) {
  return api.request("/api/auth/login", { method: "POST", body: { email, password } });
}

/** The user a token belongs to, or null if HyphaBase does not accept the token. */
export async function currentUser(api, locationId, token) {
  try {
    const { user } = await api.request("/api/auth/me", { token, locationId });
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Revokes a token. It stops working immediately. */
export async function signOut(api, locationId, token) {
  await api.request("/api/auth/logout", { method: "POST", token, locationId });
}
