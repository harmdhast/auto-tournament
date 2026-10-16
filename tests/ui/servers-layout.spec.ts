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

  test('a long player name keeps Kick inside the server panel', async ({ page }) => {
    const players = [{ steamid64: '76561198000100001', name: LONG + LONG, team: 'ct' }];
    const servers = [fleetServer('a', { players })];
    await stubFleet(page, servers);
    await stubFleetDetail(page, servers);
    await page.goto('/manage/servers?server=r:a#fleet');
    const kick = page.getByTestId('fleet-kick-76561198000100001');
    await expect(kick).toBeVisible();
    const right = await kick.evaluate((el) => el.getBoundingClientRect().right);
    expect(right).toBeLessThanOrEqual(390);
    expect(await noOverflow(page)).toBe(true);
  });
});

test.describe('Servers page loading', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('a failed load shows an error with Retry, not the first-run guide', async ({ page }) => {
    await stubFleet(page, []);
    let fail = true;
    await page.route(
      (url) => url.pathname === '/api/fleet/hosts',
      (route) =>
        fail
          ? route.fulfill({ status: 500, json: { success: false, error: 'boom' } })
          : route.fulfill({ json: { success: true, count: 1, hosts: [machineHost('m1', [])] } })
    );
    await page.goto('/manage/servers');
    const alert = page.getByTestId('servers-load-error');
    await expect(alert).toBeVisible();
    await expect(page.getByTestId('machines-empty')).toHaveCount(0);
    fail = false;
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('machine-m1')).toBeVisible();
    await expect(alert).toHaveCount(0);
  });

  test('the first load shows a loading state, then the guide for an empty fleet', async ({
    page,
  }) => {
    await stubFleet(page, []);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname === '/api/fleet/hosts',
      async (route) => {
        await held;
        await route.fulfill({ json: { success: true, count: 0, hosts: [] } });
      }
    );
    await page.goto('/manage/servers');
    await expect(page.getByTestId('servers-loading')).toBeVisible();
    release();
    await expect(page.getByTestId('servers-loading')).toHaveCount(0);
    await expect(page.getByTestId('machines-empty')).toBeVisible();
  });

  test('a failed poll after a good load shows no alert', async ({ page }) => {
    await stubMachines(page, [machineHost('m1', [])]);
    let fail = false;
    await page.route(
      (url) => url.pathname === '/api/fleet/servers',
      (route) =>
        fail
          ? route.fulfill({ status: 500, json: { success: false, error: 'boom' } })
          : route.fulfill({ json: { success: true, count: 0, servers: [] } })
    );
    await page.route(
      (url) => url.pathname === '/api/fleet/keys',
      (route) => route.fulfill({ json: { success: true, keys: [] } })
    );
    await page.goto('/manage/servers');
    await expect(page.getByTestId('machine-m1')).toBeVisible();
    fail = true;
    await page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/fleet/servers' && r.status() === 500,
      { timeout: 15000 }
    );
    await expect(page.getByTestId('servers-load-error')).toHaveCount(0);
    await expect(page.getByTestId('machine-m1')).toBeVisible();
  });
});

test.describe('Servers page focus', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('machine buttons show a focus ring from the keyboard', async ({ page }) => {
    await stubFleet(page, []);
    await stubMachines(page, [machineHost('m1', [])]);
    await page.goto('/manage/servers');
    for (const name of ['More for machine-m1', 'Add servers']) {
      const button = page.getByRole('button', { name });
      await button.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
      const ring = await button.evaluate((el) => {
        const s = window.getComputedStyle(el);
        return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow };
      });
      expect(ring.style !== 'none' && ring.width > 0).toBe(true);
    }
  });
});

test.describe('Keys tab', () => {
  test('a key with chips renders without a DOM nesting warning', async ({ page, request }) => {
    await setupTestContext(page, request);
    await stubFleet(page, []);
    await stubMachines(page, [machineHost('m1', [])]);
    await page.route(
      (url) => url.pathname === '/api/fleet/keys',
      (route) =>
        route.fulfill({
          json: {
            success: true,
            count: 1,
            keys: [
              {
                id: 'k1',
                name: 'ops',
                namePrefix: null,
                maxServers: null,
                expiresAt: null,
                createdAt: 1,
                lastUsedAt: null,
                useCount: 0,
                enrolledServers: 0,
                locked: true,
                revoked: false,
                autoLink: true,
                skins: true,
              },
            ],
          },
        })
    );
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/manage/servers');
    await page.getByTestId('servers-tab-keys').click();
    await expect(page.getByTestId('fleet-keys')).toContainText('ops');
    expect(errors.filter((e) => e.includes('validateDOMNesting'))).toEqual([]);
  });
});

test.describe('Revoke confirmation', () => {
  test('the machine revoke dialog confirms with Revoke', async ({ page, request }) => {
    await setupTestContext(page, request);
    await stubFleet(page, []);
    await stubMachines(page, [machineHost('m1', [])]);
    await page.goto('/manage/servers');
    await page.getByTestId('machine-more-m1').click();
    await page.getByTestId('machine-revoke-m1').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Revoke' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });
});
