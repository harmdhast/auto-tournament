import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { log } from './logger';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
type Layer = { handle: Handler; handle_request: (...args: Parameters<Handler>) => void };

const PATCHED = Symbol.for('auto-tournament.asyncRoutes');

/**
 * Express 4 ignores a promise a handler returns, so a rejection hangs the
 * request and ends as an unhandled rejection. Every layer of every router
 * (and of `app`) goes through `Layer.prototype.handle_request`; a rejected
 * promise from it now reaches `next(err)`. Error middleware (4 args) is left
 * alone. Import this before any router is created.
 */
function patchLayer(): void {
  const probe = express.Router();
  probe.use((_req, _res, next) => next());
  const proto: Layer & { [PATCHED]?: true } = Object.getPrototypeOf(probe.stack[0]);
  if (proto[PATCHED]) return;
  proto[PATCHED] = true;
  proto.handle_request = function (this: Layer, req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next();
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch((err) => {
          if (res.headersSent)
            log.error(
              `${req.method} ${req.path}: handler rejected after the response was sent`,
              err
            );
          else next(err);
        });
      }
    } catch (err) {
      next(err);
    }
  };
}
patchLayer();

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
