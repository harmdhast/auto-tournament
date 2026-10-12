import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * The Servers page tabs never render empty, carry no stray summary line, and
 * share one spacing; a long server name on the Manage tiles stays readable.
 *
 * @tag ui
 * @tag servers
 */

test.describe('Servers tabs render', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('scaling and failover say why they are empty', async ({ page }) => {
    await page.route(
      (url) => url.pathname === '/api/fleet/autoscale',
      (route) =>
        route.fulfill({
          json: {
            settings: {},
            desired: 0,
            warm: 0,
            reserve: 0,
            demand: { running: 0, waiting: 0, soon: 0, total: 0 },
            note: null,
            machines: 0,
            servers: [],
            activity: [],
          },
        })
    );
    await page.route(
      (url) => url.pathname === '/api/fleet/failover/settings',
      (route) =>
        route.fulfill({
          json: {
            settings: { auto: true, csm: true, reserve: null },
            reserve: { configured: null, effective: 0, poolSize: 0, held: [] },
          },
        })
    );
    await page.goto('/manage/servers#autoscale');
    await expect(page.getByTestId('autoscale-empty')).toContainText('machine');
    await page.goto('/manage/servers#failover');
    await expect(page.getByTestId('failover-empty')).toContainText('Ready Up');
  });

  test('no summary line under the tabs', async ({ page }) => {
    await page.goto('/manage/servers#fleet-settings');
    await expect(page.getByTestId('fleet-push-panel')).toBeVisible();
    await expect(
      page.getByText('Admins, settings and plugins sent to Ready Up servers')
    ).toHaveCount(0);
  });

  test('tab labels share one spacing', async ({ page }) => {
    await page.goto('/manage/servers');
    await expect(page.getByRole('tab')).toHaveCount(5);
    const pads = await page
      .getByRole('tab')
      .evaluateAll((els) => els.map((e) => window.getComputedStyle(e).paddingLeft));
    expect(pads).toHaveLength(5);
    expect(new Set(pads).size).toBe(1);
  });

  test('the tab row sits close to the page title', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/manage/servers');
    const subtitle = await page.getByTestId('servers-limit').boundingBox();
    const tabs = await page.getByRole('tablist').boundingBox();
    expect(tabs!.y - (subtitle!.y + subtitle!.height)).toBeLessThanOrEqual(32);
  });

  test('a long tile name is readable on Manage', async ({ page }) => {
    const longName = 'ready-up-lan Server 1791832667679';
    const entry = (id: string, name: string) => ({
      id,
      name,
      online: true,
      status: null,
      matchSlug: null,
      matchNumber: null,
      matchRound: null,
      updatedAt: Math.floor(Date.now() / 1000),
      inGraceWindow: false,
      secondsUntilReady: null,
      allocatable: true,
      notAllocatableReason: null,
      busyReason: null,
      busyDetail: null,
    });
    await page.route('**/api/tournament/server-availability', (route) =>
      route.fulfill({
        json: {
          success: true,
          availableServerCount: 2,
          gracePeriodSeconds: 0,
          nextAllocationInSeconds: null,
          requiredServerCount: 0,
          simulationEnabled: false,
          servers: [entry('long', longName), entry('short', 'lan-x')],
        },
      })
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/manage');
    const name = page.locator(`[data-testid="manage-servers"] [title="${longName}"]`);
    await expect(name).toBeVisible();
    const fits = await name.evaluate(
      (el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight
    );
    expect(fits).toBe(true);
    await expect(name).toHaveText(longName);
    // A short name keeps its chip on the same line.
    const tile = page.locator('[data-testid="manage-servers"] [title="lan-x"]');
    await expect(tile).toBeVisible();
    const sameLine = await tile.evaluate((el) => {
      const chip = el.nextElementSibling!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return Math.abs(chip.top + chip.height / 2 - (r.top + r.height / 2)) < 8;
    });
    expect(sameLine).toBe(true);
  });
});
