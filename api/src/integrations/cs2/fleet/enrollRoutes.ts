/** Public enrollment routes of the fleet (mounted at `/api/fleet`, ./routes.ts documents them). */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { log } from '../../../utils/logger';
import { publicOrigin, publicWsOrigin } from '../../../utils/publicOrigin';
import {
  validateEnrollRequest,
  FLEET_CLOSE,
  type EnrollRequest,
  type EnrollResponse,
} from './protocol/v1';
import { FLEET_WS_PATH } from './gateway';
import * as registry from './registry';
import { fleetBus } from './service';
import { unmapV4 } from './address';
import { enrollHostHandler } from './hosts/routes';

/** 10 attempts per minute per IP (FLEET.md §15). In memory: one API process. */
const ENROLL_WINDOW_MS = 60_000;
const ENROLL_MAX = 10;
const enrollHits = new Map<string, { count: number; resetAt: number }>();

function enrollRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = [req.ip, req.socket.remoteAddress].find((address) => address) ?? 'unknown';
  let entry = enrollHits.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + ENROLL_WINDOW_MS };
    enrollHits.set(key, entry);
  }
  entry.count += 1;
  if (enrollHits.size > 10_000) {
    for (const [k, v] of enrollHits) if (v.resetAt <= now) enrollHits.delete(k);
  }
  if (entry.count > ENROLL_MAX) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    res.status(429).json({
      success: false,
      code: 'rate_limited',
      error: 'Too many enrollment attempts, slow down',
    });
    return;
  }
  next();
}

/** Test hook: forget the enrollment rate-limit counts. */
export function resetEnrollRateLimit(): void {
  enrollHits.clear();
}

/**
 * Where the server should connect: FRONTEND_BASE_URL when set, else the host
 * it enrolled through, with wss when that was https (including behind a TLS
 * proxy that sends X-Forwarded-Proto): utils/publicOrigin.ts.
 */
function wsUrl(req: Request): string {
  return `${publicWsOrigin(req)}${FLEET_WS_PATH}`;
}

export const fleetEnrollRouter = Router();

/** GET /api/fleet/install-csm.sh: the one-line machine link's script (hosts/routes.ts installCsmScript). */
fleetEnrollRouter.get('/install-csm.sh', async (req: Request, res: Response) => {
  const { installCsmScript } = await import('./hosts/routes');
  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(installCsmScript(publicOrigin(req)));
});

/**
 * POST /api/fleet/enroll
 * Body: protocol/v1/http/enroll.request.json. 201: enroll.response.json.
 * 400 invalid body, 401 invalid code/key, 403 revoked/expired/locked key or
 * revoked server, 409 key limit reached, 429 rate limited.
 */
fleetEnrollRouter.post('/enroll', enrollRateLimit, async (req: Request, res: Response) => {
  // csm enrolls a machine through the same URL with `kind: "host"` (FLEET.md §18.1).
  if (req.body?.kind === 'host') return enrollHostHandler(req, res);
  const check = validateEnrollRequest(req.body);
  if (!check.ok) {
    return res.status(400).json({
      success: false,
      code: 'invalid_request',
      error: 'Invalid enrollment request',
      details: check.errors,
    });
  }
  const body = req.body as EnrollRequest;
  try {
    const outcome = await registry.enrollServer(body);
    if (!outcome.ok) {
      log.warn(
        `[FLEET] enrollment refused (${outcome.code}) for install ${body.install_id} from ${req.ip}`
      );
      return res
        .status(outcome.status)
        .json({ success: false, code: outcome.code, error: outcome.error });
    }
    // Where it enrolled from: the connect address until its first hello (./address.ts).
    await registry.setPeerAddr(outcome.server.id, req.ip ? unmapV4(req.ip) : null);
    // A re-enrolled server's old tokens were revoked; drop a session still using one.
    if (outcome.reenrolled)
      fleetBus().disconnect(outcome.server.id, FLEET_CLOSE.REVOKED, 're-enrolled');
    log.info(
      `[FLEET] ${outcome.reenrolled ? 're-enrolled' : 'enrolled'} ${outcome.server.id} (${outcome.server.name}) via ${
        body.code !== undefined ? 'code' : 'fleet key'
      }`
    );
    const response: EnrollResponse = {
      success: true,
      server_id: outcome.server.id,
      tenant_id: 'default',
      name: outcome.server.name,
      token: outcome.token,
      ws_url: wsUrl(req),
      reenrolled: outcome.reenrolled,
    };
    return res.status(201).json(response);
  } catch (error) {
    log.error(`[FLEET] enrollment failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, code: 'internal', error: 'Enrollment failed' });
  }
});
