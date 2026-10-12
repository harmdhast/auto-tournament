import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { fleetServer, stubFleet, stubFleetDetail } from '../helpers/fleetUi';

/**
 * Ready Up servers on the server list: each says whether it takes matches
 * and, when not, why (fleet/busyReason.ts); each opens its panel.
 *
 * @tag ui
 * @tag fleet
 */

test.describe('Ready Up servers on the server list', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('each Ready Up server shows whether it takes matches, and why not', async ({ page }) => {
    const servers = [
      fleetServer('a', {
        availability: 'busy',
        availabilityReason: 'awaiting_reset',
        availabilityDetail: 'm1',
      }),
      fleetServer('b', { availabilityReason: 'reserved' }),
      fleetServer('c'),
      fleetServer('d', { availability: 'busy' }),
    ];
    await stubFleet(page, servers);
    await stubFleetDetail(page, servers);
    await page.goto('/manage/servers');
    const row = (id: string) => page.getByTestId(`server-row-r:${id}`);
    await expect(row('a')).toContainText('Waiting for reset after the series');
    await expect(row('a').getByTestId('fleet-availability-a')).toHaveText('Busy');
    await expect(row('b').getByTestId('fleet-availability-b')).toHaveText('Spare');
    await expect(row('b')).toContainText('Spare for failover');
    await expect(row('c').getByTestId('fleet-availability-c')).toHaveText('Free');
    await expect(row('c').getByTestId('fleet-reason-c')).toHaveCount(0);
    // Busy without a reason (older Ready Up): the chip only.
    await expect(row('d').getByTestId('fleet-availability-d')).toHaveText('Busy');
    await expect(row('d').getByTestId('fleet-reason-d')).toHaveCount(0);
  });

  test('server records without Ready Up are not listed; Ready Up records are not listed twice', async ({
    page,
  }) => {
    const row = (id: string, transport: 'rcon' | 'fleet') => ({
      id,
      name: `srv-${id}`,
      host: '10.0.0.1',
      port: 27015,
      enabled: true,
      transport,
      status: 'online',
      lastSeen: Math.floor(Date.now() / 1000),
    });
    const servers = [row('rcon-1', 'rcon'), row('fleet-1', 'fleet')];
    await page.route(
      (url) => url.pathname === '/api/servers',
      (route) => route.fulfill({ json: { success: true, servers } })
    );
    await page.goto('/manage/servers');
    await expect(page.getByTestId('servers-add')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('srv-rcon-1')).toHaveCount(0);
    await expect(page.getByText('srv-fleet-1')).toHaveCount(0);
  });

  test('a Ready Up server opens in its own panel; offline and gone servers say so', async ({
    page,
  }) => {
    const servers = [
      fleetServer('a', {
        availability: 'busy',
        availabilityReason: 'local_match',
        availabilityDetail: 'cup-final',
      }),
      fleetServer('off', { online: false }),
      fleetServer('old', {
        readyUpUpdate: { state: 'outdated', running: '0.1.0', latest: '0.5.0', releaseUrl: null },
        token: {
          id: 't1',
          createdAt: 1,
          lastUsedAt: null,
          rotationDueAt: 1893456000,
          rotationPending: false,
        },
      }),
    ];
    await stubFleet(page, servers);
    await stubFleetDetail(page, servers);
    await page.goto('/manage/servers');
    await page.getByTestId('server-row-r:a').click();
    const sheet = page.getByTestId('server-panel');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('ru-a');
    await expect(sheet).toContainText('Local match cup-final still loaded');
    await expect(page).toHaveURL(/[?&]server=r%3Aa/);
    await page.reload();
    await expect(page.getByTestId('server-panel')).toContainText(
      'Local match cup-final still loaded'
    );
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('server-panel')).toHaveCount(0);
    await expect(page).not.toHaveURL(/server=/);

    await page.getByTestId('server-row-r:off').click();
    await expect(page.getByTestId('server-panel')).toContainText('Offline');

    await page.getByTestId('side-sheet-close').click();
    await page.getByTestId('server-row-r:old').click();
    await expect(page.getByTestId('server-panel')).toContainText('Update available: 0.5.0');
    await expect(page.getByTestId('server-panel')).toContainText('Token renewal');

    await page.goto('/manage/servers?fleetServer=nope');
    await expect(page.getByTestId('server-panel')).toContainText('This server is gone');
  });
});
