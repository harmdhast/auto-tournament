/**
 * Cookie header as a name -> value map. A value that is not valid
 * percent-encoding keeps its raw form instead of throwing, so one bad pair
 * never hides the others or fails the request. Later pairs win.
 */
export function readCookies(cookieHeader: string | undefined): Record<string, string> {
  const pairs: [string, string][] = [];
  if (!cookieHeader || typeof cookieHeader !== 'string') return {};
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const name = eq === -1 ? trimmed : trimmed.slice(0, eq);
    const raw = eq === -1 ? '' : trimmed.slice(eq + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // keep the raw value
    }
    pairs.push([name, value]);
  }
  return Object.fromEntries(pairs);
}
