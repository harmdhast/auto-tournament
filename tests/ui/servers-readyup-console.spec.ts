import { test, expect, type Page } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { fleetServer, stubFleet, stubFleetDetail } from '../helpers/fleetUi';

/**
 * The console in a Ready Up server's panel runs one line (fleet `exec`, root
 * only, FLEET.md D10). Other admins see that it is for root admins, never a
 * raw refusal.
 *
 * @tag ui
 * @tag fleet
 */

async function asRoot(page: Page, root: boolean) {
  await page.route(
    (url) => url.pathname === '/api/auth/me',
    async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, root } });
    }
  );
}

test.describe('Ready Up fleet: console', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    const servers = [fleetServer('a')];
    await stubFleet(page, servers);
    await stubFleetDetail(page, servers);
  });

  test('a root admin runs a line and sees its output', async ({ page }) => {
    await asRoot(page, true);
    let sent: unknown = null;
    await page.route(
      (url) => url.pathname === '/api/rcon/command',
      async (route) => {
        sent = route.request().postDataJSON();
        await route.fulfill({
          json: {
            success: true,
            results: [
              {
                serverId: 'cs2-a',
                success: true,
                transport: 'fleet',
                status: 'ok',
                response: 'hostname: lan-1\nplayers: 2',
              },
            ],
          },
        });
      }
    );
    await page.goto('/manage/servers?fleetServer=a#fleet');
    const input = page.getByTestId('fleet-console-input');
    await input.fill('status');
    await input.press('Enter');
    await expect(page.getByTestId('fleet-console-output')).toContainText('hostname: lan-1');
    expect(sent).toEqual({ serverIds: ['cs2-a'], command: 'custom', value: 'status' });
  });

  test('other admins see that the console is for root admins', async ({ page }) => {
    await asRoot(page, false);
    await page.goto('/manage/servers?fleetServer=a#fleet');
    await expect(page.getByTestId('server-panel')).toContainText('Root admins only');
    await expect(page.getByTestId('fleet-console-input')).toHaveCount(0);
  });

  test('a refusal from the server reads as root only, not the raw error', async ({ page }) => {
    await asRoot(page, true);
    await page.route(
      (url) => url.pathname === '/api/rcon/command',
      (route) =>
        route.fulfill({
          status: 207,
          json: {
            success: false,
            results: [
              {
                serverId: 'cs2-a',
                success: false,
                error: 'Raw console commands on Ready Up servers are for root admins only',
              },
            ],
          },
        })
    );
    await page.goto('/manage/servers?fleetServer=a#fleet');
    await page.getByTestId('fleet-console-input').fill('status');
    await page.getByTestId('fleet-console-input').press('Enter');
    await expect(page.getByTestId('server-panel')).toContainText('Root admins only');
    await expect(page.getByText(/Raw console commands/)).toHaveCount(0);
  });
});
