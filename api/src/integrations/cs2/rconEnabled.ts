import type { NextFunction, Request, Response } from 'express';

export function isRconEnabled(): boolean {
  const flag = (process.env.ENABLE_TEST_ENDPOINTS ?? '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

export function requireRconEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!isRconEnabled()) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  next();
}
