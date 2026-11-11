/** A fetch stand-in that records calls and answers from a queue. */
export function fakeFetch(...responses) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    const { status = 200, body = null } = responses.shift() ?? {};
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  return { fetch, calls };
}
