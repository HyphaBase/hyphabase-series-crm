/**
 * The smallest possible HyphaBase client: fetch plus a secret key.
 *
 * The API is plain HTTP and JSON, so the early episodes call it directly
 * to show there is nothing hidden. A later episode replaces this file
 * with the official SDK.
 */

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? `HyphaBase API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Reads and checks the two settings every script needs. */
export function loadConfig(env = process.env) {
  for (const name of ["HYPHABASE_API_URL", "HYPHABASE_SECRET_KEY"]) {
    if (!env[name]) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }

  const key = env.HYPHABASE_SECRET_KEY;
  if (!key.startsWith("sk_")) {
    throw new Error("HYPHABASE_SECRET_KEY must be a secret (sk_) key. Custom data is server-side only.");
  }
  if (key.endsWith("...")) {
    throw new Error("HYPHABASE_SECRET_KEY is still the placeholder. Put your own key in .env.");
  }

  return { url: env.HYPHABASE_API_URL, key };
}

export function createApi({ url, key, fetch = globalThis.fetch }) {
  const base = url.replace(/\/$/, "");

  return {
    async request(path, { method = "GET", body } = {}) {
      const headers = { Accept: "application/json", Authorization: `Bearer ${key}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";

      const res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // Not JSON: a proxy or gateway error page. The status says enough.
      }

      if (!res.ok) throw new ApiError(res.status, json);
      return json;
    },
  };
}

/** Turns any failure into one message a person can act on. */
export function describeError(error) {
  if (!(error instanceof ApiError)) {
    if (error instanceof TypeError) {
      return `Could not reach the API (${error.cause?.code ?? error.message}). Check HYPHABASE_API_URL in .env.`;
    }
    return error.message;
  }

  if (error.status === 401) {
    return `${error.message} Check HYPHABASE_SECRET_KEY in .env.`;
  }
  if (error.status === 403) {
    return `${error.message} The key is missing a scope this step needs (see .env.example).`;
  }
  if (error.status === 422 && error.body?.errors) {
    const lines = Object.entries(error.body.errors).map(([field, messages]) => `  ${field}: ${[].concat(messages).join(" ")}`);
    return `The API refused the data:\n${lines.join("\n")}`;
  }

  return `API ${error.status}: ${error.message}`;
}

/** Runs a script's main function and exits non-zero with a readable message. */
export async function run(main) {
  try {
    await main(createApi(loadConfig()));
  } catch (error) {
    console.error(describeError(error));
    process.exitCode = 1;
  }
}
