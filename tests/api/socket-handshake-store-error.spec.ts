import { test, expect } from '@playwright/test';
import { createServer, get, type Server } from 'http';
import type { AddressInfo } from 'net';
import session from 'express-session';
import { sign } from 'cookie-signature';
import { initializeSocket, type HandshakeMiddleware } from '../../api/src/services/socketService';

/**
 * A session store that fails after the handshake response went out must not
 * take the API down: express-session reports the commit failure through
 * `next(err)` once the response has ended, and Engine.IO answers every
 * middleware error by writing a second response.
 */

const SECRET = 'handshake-secret';

class FailingCommitStore extends session.Store {
  get(_sid: string, cb: (err: unknown, s?: session.SessionData | null) => void) {
    cb(null, { cookie: { originalMaxAge: 60000, maxAge: 60000 } } as session.SessionData);
  }
  set(_sid: string, _s: session.SessionData, cb?: (err?: unknown) => void) {
    cb?.(new Error('session store down'));
  }
  touch(_sid: string, _s: session.SessionData, cb?: () => void) {
    (cb as ((err?: unknown) => void) | undefined)?.(new Error('session store down'));
  }
  destroy(_sid: string, cb?: (err?: unknown) => void) {
    cb?.();
  }
}

test('socket handshake survives a session store failing at commit', async () => {
  const uncaught: unknown[] = [];
  const onUncaught = (err: unknown) => uncaught.push(err);
  process.on('uncaughtException', onUncaught);

  const httpServer: Server = createServer();
  const sessionMiddleware = session({
    name: 'at.sid',
    store: new FailingCommitStore(),
    secret: SECRET,
    resave: false,
    saveUninitialized: false,
  });
  const io = initializeSocket(httpServer, {
    handshakeMiddleware: [sessionMiddleware as unknown as HandshakeMiddleware],
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;

  try {
    const cookie = `at.sid=${encodeURIComponent('s:' + sign('known-sid', SECRET))}`;
    await new Promise<void>((resolve, reject) => {
      get(
        `http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`,
        { headers: { cookie } },
        (res) => {
          res.resume();
          res.on('end', resolve);
        }
      ).on('error', reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(uncaught).toEqual([]);
  } finally {
    process.off('uncaughtException', onUncaught);
    await io.close();
  }
});
