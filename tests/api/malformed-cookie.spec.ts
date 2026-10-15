import { test, expect } from '@playwright/test';
import { io } from 'socket.io-client';
import { readCookies } from '../../api/src/utils/cookieHeader';
import {
  getVerifiedPlayerSteamId,
  signPlayerSteamId,
} from '../../api/src/utils/signedPlayerCookie';
import {
  getSignedImpersonatedSteamId,
  signImpersonatedSteamId,
} from '../../api/src/utils/impersonationCookie';

/**
 * A Cookie header with a malformed %-escape is read pair by pair: the bad pair
 * keeps its raw value, the others still parse, and neither HTTP auth nor the
 * socket handlers fail on it.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const TAGS = { tag: ['@api', '@auth', '@security'] };
const BAD = 'x=%E0';

test.describe('cookie header reader (pure)', () => {
  test('keeps the raw value of a malformed pair and parses the rest', TAGS, () => {
    expect(readCookies(`${BAD}; a=b%20c; d=e=f`)).toEqual({ x: '%E0', a: 'b c', d: 'e=f' });
    expect(readCookies(undefined)).toEqual({});
  });

  test('signed cookies verify next to a malformed pair', TAGS, () => {
    const id = '76561198000000002';
    const player = `player_steam_id=${encodeURIComponent(signPlayerSteamId(id))}`;
    const imp = `mat_impersonate=${encodeURIComponent(signImpersonatedSteamId(id))}`;
    expect(getVerifiedPlayerSteamId(`${BAD}; ${player}`)).toBe(id);
    expect(getSignedImpersonatedSteamId(`${BAD}; ${imp}`)).toBe(id);
    expect(getVerifiedPlayerSteamId('player_steam_id=%E0')).toBeNull();
  });
});

test.describe('malformed cookie on the wire', () => {
  test('an admin route answers 401', TAGS, async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    try {
      const res = await ctx.get('/api/auth/impersonate', {
        headers: { Cookie: BAD },
        timeout: 5_000,
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('player:subscribe answers and the API stays up', TAGS, async ({ request, baseURL }) => {
    const socket = io(baseURL!, {
      transports: ['polling'],
      extraHeaders: { Cookie: BAD },
      forceNew: true,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      const ack = await socket.timeout(5_000).emitWithAck('player:subscribe');
      expect(ack).toEqual({ ok: false });
    } finally {
      socket.close();
    }
    await expect
      .poll(async () => (await request.get('/health').catch(() => null))?.status() ?? 0, {
        timeout: 5_000,
      })
      .toBe(200);
  });
});
