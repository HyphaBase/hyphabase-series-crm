/**
 * What the pages call. Every function here talks to this app's own
 * server (app/api/), never to HyphaBase: the browser has no key and never
 * sees a token. The session travels in a cookie the browser sends by
 * itself.
 */

import { toSearch, type Customer, type CustomerChanges, type CustomerErrors, type CustomerInput, type ListFilter } from "./customers";

export interface Me {
  user: { id: string; name: string; email: string };
  permissions: string[];
}

export interface CustomerPage {
  data: Customer[];
  next_cursor: string | null;
}

/** A refusal from the server: the status, a sentence for the person, and any per-field messages. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: CustomerErrors = {},
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "The CRM is not responding. Check your connection and try again.");
  }

  const answer = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, answer?.error ?? "Something went wrong.", answer?.errors);
  return answer as T;
}

export const api = {
  /** The signed-in person, or null when nobody is signed in. */
  async me(): Promise<Me | null> {
    try {
      return await call<Me>("GET", "/api/me");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  signIn: (email: string, password: string) => call<{ user: Me["user"] }>("POST", "/api/login", { email, password }),
  signOut: () => call<null>("POST", "/api/logout"),
  /** One page of customers that match, and the cursor for the page after it (null on the last one). */
  customers: (filter: ListFilter, cursor?: string | null) => call<CustomerPage>("GET", `/api/customers${toSearch({ ...filter, cursor })}`),
  addCustomer: async (customer: CustomerInput) => (await call<{ data: Customer }>("POST", "/api/customers", customer)).data,
  updateCustomer: async (id: string, changes: CustomerChanges) => (await call<{ data: Customer }>("PATCH", `/api/customers/${id}`, changes)).data,
  deleteCustomer: (id: string) => call<null>("DELETE", `/api/customers/${id}`),
};
