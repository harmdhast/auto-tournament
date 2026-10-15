import type { NextFunction, Request, Response } from 'express';

/** True when ENABLE_TEST_ENDPOINTS is explicitly on. */
export function testEndpointsFlag(): boolean {
  const enabled = (process.env.ENABLE_TEST_ENDPOINTS || '').toLowerCase();
  return enabled === '1' || enabled === 'true' || enabled === 'yes';
}

/** True outside production, or when the flag is explicitly on. */
export function testEndpointsAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || testEndpointsFlag();
}

/**
 * Gate for test-only routes. `flag` requires ENABLE_TEST_ENDPOINTS and answers
 * 404; `production` only refuses in production and answers 403 with `body`.
 */
export function requireTestEndpoints(
  gate: { tier: 'flag' } | { tier: 'production'; body: Record<string, unknown> }
) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (gate.tier === 'flag') {
      if (!testEndpointsFlag()) {
        res.status(404).json({ success: false, error: 'Not found' });
        return;
      }
    } else if (!testEndpointsAllowed()) {
      res.status(403).json(gate.body);
      return;
    }
    next();
  };
}
