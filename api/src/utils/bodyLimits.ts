import express, { type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';

/** Default limits for every request body, read before anyone is authenticated. */
export const JSON_LIMIT = '1mb';
export const URLENCODED_LIMIT = '100kb';
export const URLENCODED_PARAMETER_LIMIT = 100;

/**
 * Admin routes whose JSON bodies carry files (base64 images, pack icons, a
 * demo analysis). The default parser skips them; `largeJsonAfterAuth` reads
 * them with their own limit once the caller is known to be an admin.
 */
export const LARGE_JSON_ROUTES: ReadonlyArray<{ method: string; path: RegExp; limit: string }> = [
  { method: 'POST', path: /^\/api\/maps\/[^/]+\/upload-image$/, limit: '10mb' },
  { method: 'PUT', path: /^\/api\/game\/cs2\/radars\/[^/]+\/[^/]+$/, limit: '12mb' },
  {
    method: 'POST',
    path: /^\/api\/game\/cs2\/demo-worker\/jobs\/[^/]+\/[^/]+\/result$/,
    limit: '50mb',
  },
  { method: 'POST', path: /^\/api\/packs$/, limit: '4mb' },
  { method: 'POST', path: /^\/api\/players\/(?:bulk-)?import$/, limit: '10mb' },
];

function largeRoute(req: Request) {
  return LARGE_JSON_ROUTES.find((r) => r.method === req.method && r.path.test(req.path));
}

const json = express.json({ limit: JSON_LIMIT });
const urlencoded = express.urlencoded({
  extended: true,
  limit: URLENCODED_LIMIT,
  parameterLimit: URLENCODED_PARAMETER_LIMIT,
});

/** Global JSON and form parsers; the large routes are left unread. */
export function defaultBodies(req: Request, res: Response, next: NextFunction): void {
  if (largeRoute(req)) return next();
  json(req, res, (err?: unknown) => (err ? next(err) : urlencoded(req, res, next)));
}

const largeParsers = new Map(
  LARGE_JSON_ROUTES.map((r) => [r.limit, express.json({ limit: r.limit })])
);

/** The large routes: an admin first, then the body with that route's limit. */
export function largeJsonAfterAuth(req: Request, res: Response, next: NextFunction): void {
  const route = largeRoute(req);
  if (!route) return next();
  void requireAuth(req, res, () => largeParsers.get(route.limit)!(req, res, next));
}
