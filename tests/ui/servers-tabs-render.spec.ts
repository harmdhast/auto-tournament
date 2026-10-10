import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { createTestServer } from '../helpers/servers';

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
      (url) => url.pathname === '/api/fleet/hosts',
      (route) => route.fulfill({ json: { success: true, count: 0, hosts: [] } })
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

  test('a long tile name is readable on Manage', async ({ page, request }) => {
    const server = await createTestServer(request, 'rcon-legacy');
    expect(server).toBeTruthy();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/manage');
    const name = page.locator(`[data-testid="manage-servers"] [title="${server!.name}"]`);
    await expect(name).toBeVisible();
    const fits = await name.evaluate(
      (el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight
    );
    expect(fits).toBe(true);
    await expect(name).toHaveText(server!.name);
  });
});
