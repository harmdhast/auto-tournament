import type { NextFunction, Request, RequestHandler, Response } from 'express';
// @ts-expect-error no @types/express-session installed (as in index.ts)
import session from 'express-session';
import { isIP } from 'net';

// The session cookie's own name: express-session's default `connect.sid` is
// shared with every other Express app, and one on a parent domain (e.g.
// another site on *.example.com with Domain=example.com) is sent along too.
// The browser sends the older cookie first and express-session reads the
// first, so a fresh install behind such a domain never saw its own session
// (setup signed the new admin in, the next request was signed out).
/** A connect-compatible session store. */
type SessionStore = object;

export const SESSION_COOKIE_NAME = 'at.sid';

/** The Domain for the session cookie: FRONTEND_BASE_URL's host when it is a DNS name. */
export function sessionCookieDomainFor(frontendBaseUrl: string): string | undefined {
  try {
    if (!frontendBaseUrl) return undefined;
    const u = new URL(
      frontendBaseUrl.startsWith('http') ? frontendBaseUrl : `https://${frontendBaseUrl}`
    );
    const host = u.hostname.toLowerCase();
    // Setting Domain= on an IP can cause cookies to be dropped or behave unexpectedly.
    if (host && host !== 'localhost' && host !== '127.0.0.1' && isIP(host) === 0) return host;
  } catch {
    // Invalid URL, skip domain
  }
  return undefined;
}

/** Whether a browser on `hostname` would send a cookie with `Domain=domain`. */
export function hostMatchesCookieDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

export interface SessionMiddlewareOptions {
  /**
   * One store per middleware: express-session installs its cookie options on
   * the store it is given (`store.generate`), so two middlewares sharing one
   * store would both issue the last one's cookies.
   */
  domainStore: SessionStore;
  hostOnlyStore: SessionStore;
  secret: string;
  frontendBaseUrl: string;
  /** NODE_ENV === 'production': an https FRONTEND_BASE_URL then makes the cookie Secure. */
  production: boolean;
  warn: (message: string) => void;
}

/**
 * The session middleware for a request's host.
 *
 * On FRONTEND_BASE_URL's host (or a subdomain) the cookie carries its Domain,
 * so it survives a proxy that rewrites Host, and is Secure on an https
 * deployment. Any other host (an IP address, a LAN name, a fresh install
 * before its domain points here) would have that cookie dropped by the
 * browser, or never receive it over plain http, so it gets a host-only cookie,
 * Secure only over https.
 */
export function createSessionMiddleware(opts: SessionMiddlewareOptions): RequestHandler {
  const secureBase = opts.production && opts.frontendBaseUrl.startsWith('https://');
  const domain = sessionCookieDomainFor(opts.frontendBaseUrl);
  const common = {
    name: SESSION_COOKIE_NAME,
    secret: opts.secret,
    resave: false,
    saveUninitialized: false,
  };
  const domainSession = session({
    ...common,
    store: opts.domainStore,
    // The Secure decision follows X-Forwarded-Proto even when Express does not
    // trust the proxy that sent it.
    proxy: true,
    cookie: { sameSite: 'lax', secure: secureBase, httpOnly: true, ...(domain ? { domain } : {}) },
  });
  const hostOnlySession = session({
    ...common,
    store: opts.hostOnlyStore,
    cookie: { sameSite: 'lax', secure: 'auto', httpOnly: true },
  });
  let warned = false;
  return (req: Request, res: Response, next: NextFunction) => {
    const host = req.hostname;
    const hostOnly = isIP(host) !== 0 || (!!domain && !hostMatchesCookieDomain(host, domain));
    if (hostOnly) return hostOnlySession(req, res, next);
    if (secureBase && !warned) {
      const proto = String(req.headers['x-forwarded-proto'] ?? '')
        .split(',')[0]
        .trim()
        .toLowerCase();
      if (!req.secure && proto !== 'https') {
        warned = true;
        opts.warn(
          'FRONTEND_BASE_URL is https but a request arrived as plain http without X-Forwarded-Proto: the Secure session cookie cannot be set and admin sign-in will fail. Make the reverse proxy send X-Forwarded-Proto (for the bundled Caddy: list the proxy in TRUSTED_PROXIES).'
        );
      }
    }
    return domainSession(req, res, next);
  };
}
