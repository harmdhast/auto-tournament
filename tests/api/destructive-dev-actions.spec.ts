import { test, expect, request as newRequest } from '@playwright/test';
import type { Request, Response } from 'express';
import { signInViaRequest } from '../helpers/auth';
import tournamentRoutes from '../../api/src/routes/tournament';

/**
 * Wipe database, wipe a table and reset the simulation state: a signed-in
 * browser session only (no API token), same-site JSON, and a typed
 * confirmation in the body. The /dev/ reset also needs ENABLE_TEST_ENDPOINTS.
 *
 * @tag api
 * @tag security
 */

const TAGS = { tag: ['@api', '@security'] };
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const ADMIN_TOKEN = (process.env.API_TOKENS || 'ci-admin:ci-admin-token-0123456789abcdef')
  .split(',')[0]
  .split(':')
  .slice(1)
  .join(':');
const TABLE = 'shuffle_tournament_players';

test.describe.serial('destructive dev actions', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('an API token is refused, even with the confirmation', TAGS, async () => {
    const api = await newRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    try {
      for (const [path, confirm] of [
        [`/api/tournament/wipe-table/${TABLE}`, TABLE],
        ['/api/tournament/dev/reset-simulation-state', 'reset'],
        ['/api/tournament/wipe-database', 'wipe'],
      ]) {
        const res = await api.post(path, { data: { confirm } });
        expect(res.status(), `${path}: ${await res.text()}`).toBe(403);
      }
    } finally {
      await api.dispose();
    }
  });

  test(
    'a session needs the typed confirmation and a same-site request',
    TAGS,
    async ({ request }) => {
      for (const path of [
        `/api/tournament/wipe-table/${TABLE}`,
        '/api/tournament/dev/reset-simulation-state',
        '/api/tournament/wipe-database',
      ]) {
        const bare = await request.post(path);
        expect(bare.status(), `${path}: ${await bare.text()}`).not.toBe(200);
        const wrong = await request.post(path, { data: { confirm: 'teams' } });
        expect(wrong.status(), `${path}: ${await wrong.text()}`).toBe(400);
      }
      const crossSite = await request.post(`/api/tournament/wipe-table/${TABLE}`, {
        data: { confirm: TABLE },
        headers: { Origin: 'https://evil.example' },
      });
      expect(crossSite.status()).toBe(403);

      const table = await request.post(`/api/tournament/wipe-table/${TABLE}`, {
        data: { confirm: TABLE },
      });
      expect(table.status(), await table.text()).toBe(200);
      const reset = await request.post('/api/tournament/dev/reset-simulation-state', {
        data: { confirm: 'reset' },
      });
      expect(reset.status(), await reset.text()).toBe(200);
    }
  );

  test('the /dev/ reset is off without ENABLE_TEST_ENDPOINTS', TAGS, () => {
    const layer = (
      tournamentRoutes as unknown as {
        stack: Array<{
          route?: {
            path: string;
            stack: Array<{ handle: (req: Request, res: Response, next: () => void) => void }>;
          };
        }>;
      }
    ).stack.find((l) => l.route?.path === '/dev/reset-simulation-state');
    const saved = process.env.ENABLE_TEST_ENDPOINTS;
    delete process.env.ENABLE_TEST_ENDPOINTS;
    try {
      let status = 0;
      let passed = false;
      const res = {
        status(code: number) {
          status = code;
          return this;
        },
        json() {
          return this;
        },
      } as unknown as Response;
      layer!.route!.stack[0].handle({} as Request, res, () => {
        passed = true;
      });
      expect({ status, passed }).toEqual({ status: 404, passed: false });
    } finally {
      if (saved !== undefined) process.env.ENABLE_TEST_ENDPOINTS = saved;
    }
  });
});
