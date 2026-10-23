import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * The Discord add-on's admin writes refuse a cross-site or non-JSON request.
 *
 * @tag api
 */
test.describe('Discord add-on writes', () => {
  test('refuse a cross-site or non-JSON request', { tag: ['@api'] }, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const on = await request.put('/api/addons/discord', { data: { enabled: true } });
    expect(on.status()).toBe(200);
    try {
      const writes: [string, object][] = [
        ['token', { token: null }],
        ['guild', { guildId: null }],
        ['match-voice', { enabled: false }],
        ['team-channels', { enabled: false }],
      ];
      for (const [path, data] of writes) {
        const url = `/api/addons/discord/${path}`;
        const crossSite = await request.put(url, {
          data,
          headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        });
        expect(crossSite.status(), path).toBe(403);
        const notJson = await request.put(url, { form: { a: '1' } });
        expect(notJson.status(), path).toBe(415);
      }
    } finally {
      await request.put('/api/addons/discord', { data: { enabled: false } });
    }
  });
});
