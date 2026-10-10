import { test, expect, request as newRequest } from '@playwright/test';

/**
 * /api/auth/me says whether the viewer is a root admin (FLEET.md D10): an
 * admin-scope API token, the local admin, or a listed admin Steam ID. The
 * client shows the Ready Up console only to them.
 *
 * @tag api
 */

const ADMIN_TOKEN = (process.env.API_TOKENS || 'ci-admin:ci-admin-token-0123456789abcdef')
  .split(',')[0]
  .split(':')
  .slice(1)
  .join(':');
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

test('an admin API token is root; nobody signed in is not', async () => {
  const anon = await newRequest.newContext({ baseURL: BASE });
  try {
    const admin = await anon.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect((await admin.json()).root).toBe(true);
    const nobody = await anon.get('/api/auth/me');
    expect((await nobody.json()).root).toBe(false);
  } finally {
    await anon.dispose();
  }
});
