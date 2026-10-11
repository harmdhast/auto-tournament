import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { machineHost, stubFleet, stubMachines } from '../helpers/fleetUi';

/**
 * A machine csm has not linked yet has nothing to report: its card says
 * whether its code expired, and its panel says what to do, with New code and
 * Remove at hand.
 *
 * @tag ui
 * @tag servers
 */

const pending = (over: Record<string, unknown> = {}) =>
  machineHost('p1', [], {
    name: 'test-machine',
    status: 'pending',
    online: false,
    hostname: null,
    os: null,
    csmVersion: null,
    inventory: null,
    inventoryAt: null,
    lastSeen: null,
    connectedAt: null,
    createdAt: Math.floor(Date.now() / 1000) - 3600,
    codeExpiresAt: null,
    ...over,
  });

test.describe('A machine waiting to be linked', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    await stubFleet(page, []);
  });

  test('an expired code says so on the card', async ({ page }) => {
    await stubMachines(page, [pending()]);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-group-p1')).toContainText('Code expired');
  });

  test('its panel explains the next step and offers a new code', async ({ page }) => {
    await stubMachines(page, [pending()]);
    let asked = 0;
    await page.route(
      (url) => url.pathname === '/api/fleet/hosts/p1/code',
      (route) => {
        asked += 1;
        return route.fulfill({
          json: {
            success: true,
            code: 'RUE-TEST-CODE',
            expiresAt: Math.floor(Date.now() / 1000) + 600,
          },
        });
      }
    );
    await page.goto('/manage/servers?machine=p1');
    const sheet = page.getByTestId('machine-sheet');
    await expect(sheet.getByTestId('machine-sheet-status')).toContainText('Code expired');
    await expect(sheet.getByTestId('machine-sheet-status')).toContainText('Added');
    await expect(sheet).toContainText('csm link');
    await expect(sheet.getByTestId('machine-sheet-remove')).toBeVisible();
    await sheet.getByTestId('machine-sheet-new-code').click();
    await expect(page.getByText('RUE-TEST-CODE')).toBeVisible();
    expect(asked).toBe(1);
  });

  test('a linked machine without a report yet says it waits for one', async ({ page }) => {
    await stubMachines(page, [
      pending({
        status: 'enrolled',
        online: true,
        connectedAt: 1,
        lastSeen: Math.floor(Date.now() / 1000),
      }),
    ]);
    await page.goto('/manage/servers?machine=p1');
    await expect(page.getByTestId('machine-sheet-status')).toContainText('first report');
  });
});
