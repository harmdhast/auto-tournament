import { test, expect, request } from '@playwright/test';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { jsonErrorHandler } from '../../api/src/utils/asyncRoutes';

/**
 * Express 4 does not catch a rejected async handler: the request hangs. The
 * patch in utils/asyncRoutes sends the rejection to `next(err)`.
 *
 * @tag api
 */

const TAGS = { tag: ['@api'] };

let server: Server;
let base: string;

test.beforeAll(async () => {
  const app = express();
  app.get('/app-async', async () => {
    throw new Error('boom');
  });
  const router = express.Router();
  router.get('/async', async () => {
    throw new Error('boom');
  });
  router.get('/sync', () => {
    throw new Error('boom');
  });
  router.get('/ok', async (_req, res) => {
    await Promise.resolve();
    res.json({ ok: true });
  });
  router.get('/late', async (_req, res) => {
    res.json({ sent: true });
    throw new Error('after the response');
  });
  router.get('/status', async () => {
    throw Object.assign(new Error('teapot'), { status: 418 });
  });
  router.use(
    '/mw',
    async () => {
      throw new Error('boom');
    },
    () => undefined
  );
  app.use('/r', router);
  const late = express.Router();
  late.get('/x', async () => {
    throw new Error('boom');
  });
  setTimeout(() => app.use('/late-router', late), 0);
  app.use(jsonErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server.close();
});

const get = async (path: string) => {
  const ctx = await request.newContext();
  try {
    const res = await ctx.get(base + path, { timeout: 3000 });
    return { status: res.status(), body: await res.json().catch(() => null) };
  } finally {
    await ctx.dispose();
  }
};

test.describe('async route errors', TAGS, () => {
  test('a rejecting async route answers 500 JSON', async () => {
    const res = await get('/r/async');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  test('a rejecting async handler on app answers 500', async () => {
    expect((await get('/app-async')).status).toBe(500);
  });

  test('a rejecting async middleware answers 500', async () => {
    expect((await get('/r/mw')).status).toBe(500);
  });

  test('a router mounted later is covered', async () => {
    expect((await get('/late-router/x')).status).toBe(500);
  });

  test('a sync throw still answers 500', async () => {
    expect((await get('/r/sync')).status).toBe(500);
  });

  test('an error with its own status keeps it', async () => {
    expect((await get('/r/status')).status).toBe(418);
  });

  test('a normal async route works', async () => {
    const res = await get('/r/ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('a rejection after the response was sent leaves it alone', async () => {
    const res = await get('/r/late');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
  });
});
