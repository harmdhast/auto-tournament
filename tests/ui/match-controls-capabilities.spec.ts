import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { getAuthHeader } from '../helpers/auth';
import { setupTestContext } from '../helpers/setup';
import { createTestServer, deleteServer } from '../helpers/servers';
import { createMatch } from '../helpers/fleetFake';

/**
 * The admin match controls show only what the match's server supports
 * (GET /api/rcon/capabilities/:serverId): on Ready Up there is no skip veto.
 * When the capabilities cannot be read, every control shows, as before.
 *
 * @tag ui
 * @tag fleet
 */

async function liveMatchOn(request: APIRequestContext, serverId: string): Promise<string> {
  const slug = `caps-${Date.now()}`;
  await createMatch(request, slug);
  const res = await request.post('/api/test/match-state', {
    headers: getAuthHeader(),
    data: { slug, status: 'live', serverId },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return slug;
}

async function openControls(page: Page, slug: string) {
  await page.goto(`/manage/matches?match=${slug}`);
  await page.getByText('Admin Controls', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({
    timeout: 20000,
  });
}

test.describe('Match controls follow the server', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('a Ready Up server: no skip veto, add time kept', async ({ page, request }) => {
    const server = await createTestServer(request, 'caps');
    expect(server).not.toBeNull();
    try {
      const slug = await liveMatchOn(request, server!.id);
      await page.route(`**/api/rcon/capabilities/${server!.id}`, (route) =>
        route.fulfill({
          json: {
            success: true,
            transport: 'fleet',
            commands: ['custom', 'kick', 'reset'],
            matchControls: [
              'pause',
              'unpause',
              'swap',
              'restartRound',
              'endWarmup',
              'endMatch',
              'startMatch',
              'restoreBackup',
              'addTime',
              'broadcast',
            ],
          },
        })
      );
      await openControls(page, slug);
      await expect(page.getByRole('button', { name: 'Skip veto' })).toHaveCount(0);
      await page.getByText('Advanced actions', { exact: true }).click();
      await expect(page.getByRole('button', { name: 'Add time' })).toBeVisible();
    } finally {
      await deleteServer(request, server!.id);
    }
  });

  test('capabilities unreadable: every control shows', async ({ page, request }) => {
    const server = await createTestServer(request, 'caps');
    expect(server).not.toBeNull();
    try {
      const slug = await liveMatchOn(request, server!.id);
      await page.route(`**/api/rcon/capabilities/${server!.id}`, (route) =>
        route.fulfill({ status: 500, json: { success: false } })
      );
      await openControls(page, slug);
      await expect(page.getByRole('button', { name: 'Skip veto' })).toBeVisible();
    } finally {
      await deleteServer(request, server!.id);
    }
  });
});
