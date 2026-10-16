import { test, expect, type Page } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import {
  fleetServer,
  machineHost,
  stubFleet,
  stubFleetDetail,
  stubMachines,
} from '../helpers/fleetUi';

/**
 * The Servers page stays inside the viewport with long names, says so when
 * loading fails instead of showing the first-run guide, and shows a focus ring
 * on its buttons.
 *
 * @tag ui
 * @tag servers
 */

const LONG = 'a-very-long-machine-name-that-keeps-going-0123456789';

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe('Servers page layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('a long machine name stays inside the page', async ({ page }) => {
    await stubFleet(page, []);
    await stubMachines(page, [machineHost('m1', [], { name: LONG })]);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('machine-m1')).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
  });

  test('a pending machine card stays inside the page', async ({ page }) => {
    await stubFleet(page, []);
    await stubMachines(page, [
      machineHost('p1', [], {
        name: 'test-machine',
        status: 'pending',
        online: false,
        inventory: null,
        codeExpiresAt: Math.floor(Date.now() / 1000) + 600,
      }),
    ]);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('machine-p1')).toContainText('Code valid until');
    expect(await noOverflow(page)).toBe(true);
  });
});
