import { test, expect, type Page } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * The Ready Up fleet section's Servers tab: each server says whether it takes
 * matches and, when not, why (fleet/busyReason.ts).
 *
 * @tag ui
 * @tag fleet
 */

export const fleetServer = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  tenantId: 'default',
  name: `ru-${id}`,
  status: 'enrolled',
  installId: `inst-${id}`,
  enrolledVia: 'key',
  enrollmentKeyId: null,
  online: true,
  availability: 'available',
  availabilityReason: null,
  availabilityDetail: null,
  versions: { core: '0.1.0', plugin_api: '1.11', plugins: { fleet: '0.1.0' }, cs2_build: 14032 },
  readyUpUpdate: { state: 'current', running: '0.1.0', latest: '0.1.0', releaseUrl: null },
  capabilities: ['match.v1'],
  host: { hostname: id, game_port: 27015 },
  health: null,
  protocol: 1,
  connectedAt: 1,
  lastSeen: 1,
  createdAt: 1,
  token: null,
  rotateRequested: false,
  codeExpiresAt: null,
  linkedServerId: `cs2-${id}`,
  connect: null,
  ...over,
});

export async function stubFleet(page: Page, servers: unknown[]) {
  await page.route(
    (url) => url.pathname === '/api/fleet/servers',
    (route) => route.fulfill({ json: { success: true, count: servers.length, servers } })
  );
  await page.route(
    (url) => url.pathname === '/api/fleet/keys',
    (route) => route.fulfill({ json: { success: true, keys: [] } })
  );
}

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
});
