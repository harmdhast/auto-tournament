import type { NextFunction, Request, Response } from 'express';
import { log } from './logger';

/** Last error middleware: errors with no HTTP status of their own answer 500 JSON. */
export function jsonErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const hasStatus = 'status' in err || 'statusCode' in err;
  if (res.headersSent || hasStatus) return next(err);
  log.error(`${req.method} ${req.path}`, err);
  res.status(500).json({ error: 'Internal server error' });
}
