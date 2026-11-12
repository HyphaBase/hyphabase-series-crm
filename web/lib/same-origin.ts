/**
 * True when a request comes from this app's own pages.
 *
 * Browsers send an Origin header with every request that changes
 * something. If it names another site, the request is refused. The
 * SameSite cookie already stops that; this is the second lock.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
