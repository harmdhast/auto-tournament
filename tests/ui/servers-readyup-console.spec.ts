import { test, expect, type Page } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { fleetServer, stubFleet, stubFleetDetail } from '../helpers/fleetUi';

/**
 * The console in a Ready Up server's panel is one terminal view. Root admins
 * get an input (fleet `exec`, FLEET.md D10) on linked and unlinked servers;
 * other admins see the pane without it. Streaming is covered by the API spec.
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
  const exec = (page: Page, json: unknown, status = 200) =>
    page.route(
      (url) => url.pathname === '/api/fleet/servers/a/exec',
      (route) => route.fulfill({ status, json })
    );

  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    const servers = [fleetServer('a', { linkedServerId: null })];
    await stubFleet(page, servers);
    await stubFleetDetail(page, servers);
  });

  test('a root admin sees the input on an unlinked server', async ({ page }) => {
    await asRoot(page, true);
    await page.goto('/manage/servers?server=r:a#fleet');
    await expect(page.getByTestId('fleet-console-input')).toBeVisible();
    await expect(page.getByTestId('fleet-console-output')).toBeVisible();
  });

  test('other admins see the pane without an input', async ({ page }) => {
    await asRoot(page, false);
    await page.goto('/manage/servers?server=r:a#fleet');
    await expect(page.getByTestId('fleet-console-output')).toBeVisible();
    await expect(page.getByTestId('server-panel')).toContainText('Root admins only');
    await expect(page.getByTestId('fleet-console-input')).toHaveCount(0);
  });

  test('the command echo and its output appear in the pane', async ({ page }) => {
    await asRoot(page, true);
    let sent: unknown = null;
    await page.route(
      (url) => url.pathname === '/api/fleet/servers/a/exec',
      async (route) => {
        sent = route.request().postDataJSON();
        await route.fulfill({
          json: { success: true, transport: 'fleet', status: 'ok', response: 'hostname: lan-1' },
        });
      }
    );
    await page.goto('/manage/servers?server=r:a#fleet');
    const input = page.getByTestId('fleet-console-input');
    await input.fill('status');
    await input.press('Enter');
    const out = page.getByTestId('fleet-console-output');
    await expect(out).toContainText('> status');
    await expect(out).toContainText('hostname: lan-1');
    expect(sent).toEqual({ command: 'status' });
  });

  test('a secret in the echo is masked', async ({ page }) => {
    await asRoot(page, true);
    await exec(page, { success: true, transport: 'fleet', status: 'ok', response: '' });
    await page.goto('/manage/servers?server=r:a#fleet');
    const input = page.getByTestId('fleet-console-input');
    await input.fill('rcon_password hunter2');
    await input.press('Enter');
    const out = page.getByTestId('fleet-console-output');
    await expect(out).toContainText('> rcon_password ***');
    await expect(out).not.toContainText('hunter2');
  });

  test('a refused line shows its error in the pane', async ({ page }) => {
    await asRoot(page, true);
    await exec(page, { success: false, error: 'The Ready Up server is offline' }, 409);
    await page.goto('/manage/servers?server=r:a#fleet');
    const input = page.getByTestId('fleet-console-input');
    await input.fill('status');
    await input.press('Enter');
    await expect(page.getByTestId('fleet-console-output')).toContainText('offline');
  });
});
