import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { fleetServer, stubFleet } from '../helpers/fleetUi';

/**
 * The Ready Up fleet section's Servers tab: each server says whether it takes
 * matches and, when not, why (fleet/busyReason.ts).
 *
 * @tag ui
 * @tag fleet
 */

test.describe('Ready Up fleet: servers tab', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('each Ready Up server shows whether it takes matches, and why not', async ({ page }) => {
    await stubFleet(page, [
      fleetServer('a', {
        availability: 'busy',
        availabilityReason: 'awaiting_reset',
        availabilityDetail: 'm1',
      }),
      fleetServer('b', { availabilityReason: 'reserved' }),
      fleetServer('c'),
      fleetServer('d', { availability: 'busy' }),
    ]);
    await page.goto('/manage/servers#fleet');
    const row = (id: string) => page.getByTestId(`fleet-server-${id}`);
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

  test('servers not on a machine lists RCON servers only, and hides when there are none', async ({
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
    let servers = [row('rcon-1', 'rcon'), row('fleet-1', 'fleet')];
    await page.route(
      (url) => url.pathname === '/api/servers',
      (route) => route.fulfill({ json: { success: true, servers } })
    );
    await page.goto('/manage/servers');
    const other = page.getByTestId('servers-other');
    await expect(other).toContainText('srv-rcon-1');
    await expect(other).not.toContainText('srv-fleet-1');
    servers = [row('fleet-1', 'fleet')];
    await page.reload();
    await expect(page.getByTestId('readyup-fleet')).toBeVisible();
    await expect(page.getByTestId('servers-other')).toHaveCount(0);
  });

  test('a Ready Up server opens in its own panel; offline and gone servers say so', async ({
    page,
  }) => {
    await stubFleet(page, [
      fleetServer('a', {
        availability: 'busy',
        availabilityReason: 'local_match',
        availabilityDetail: 'cup-final',
      }),
      fleetServer('off', { online: false }),
    ]);
    await page.goto('/manage/servers#fleet');
    await page.getByTestId('fleet-open-a').click();
    const sheet = page.getByTestId('fleet-server-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('ru-a');
    await expect(sheet).toContainText('Local match cup-final still loaded');
    await expect(page).toHaveURL(/[?&]fleetServer=a/);
    await page.reload();
    await expect(page.getByTestId('fleet-server-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('fleet-server-sheet')).toHaveCount(0);
    await expect(page).not.toHaveURL(/fleetServer=/);

    await page.getByTestId('fleet-open-off').click();
    await expect(page.getByTestId('fleet-server-sheet')).toContainText('Offline');

    await page.goto('/manage/servers?fleetServer=nope#fleet');
    await expect(page.getByTestId('fleet-server-sheet')).toContainText('This server is gone');
  });
});
