import { test, expect, type Page } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { fleetServer, stubFleet, stubFleetDetail } from '../helpers/fleetUi';

/**
 * What is pushed to one Ready Up server lives in its panel (practice,
 * settings, whitelist, plugins, push state); the Push tab keeps the
 * fleet-wide items only.
 *
 * @tag ui
 * @tag fleet
 */

async function stubPush(page: Page, settingsStatus: 'ok' | 'failed') {
  const item = (status: string, message: string | null = null) => ({
    at: 1,
    rev: 1,
    acked: true,
    status,
    errorCode: status === 'failed' ? 'bad_value' : null,
    message,
    output: null,
  });
  await page.route(
    (url) => url.pathname === '/api/fleet/servers/a/push',
    (route) =>
      route.fulfill({
        json: {
          success: true,
          serverId: 'a',
          online: true,
          settingsRev: 1,
          override: null,
          effective: {},
          whitelist: null,
          practice: false,
          plugins: null,
          pluginSet: null,
          pluginsState: null,
          pushed: {
            admins: item('ok'),
            serverConfig: null,
            settings:
              settingsStatus === 'failed'
                ? item('failed', 'mp_maxrounds out of range')
                : item('ok'),
            whitelist: null,
            practice: null,
            plugins: null,
          },
        },
      })
  );
}

test.describe('Ready Up server panel: push', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    const servers = [fleetServer('a')];
    await stubFleet(page, servers);
    await stubFleetDetail(page, servers);
  });

  test('the panel pushes practice for one server', async ({ page }) => {
    await stubPush(page, 'ok');
    let sent: unknown = null;
    await page.route(
      (url) => url.pathname === '/api/fleet/servers/a/practice',
      async (route) => {
        sent = route.request().postDataJSON();
        await route.fulfill({
          json: { success: true, command: { id: 'c1', delivered: true, status: 'ok' } },
        });
      }
    );
    await page.goto('/manage/servers?server=r:a');
    const push = page.getByTestId('server-panel').getByTestId('server-panel-push');
    await push.getByTestId('fleet-practice-a').click();
    await expect.poll(() => sent).toEqual({ on: true });
  });

  test('a failed push reads in the panel', async ({ page }) => {
    await stubPush(page, 'failed');
    await page.goto('/manage/servers?server=r:a');
    await expect(page.getByTestId('server-panel-push-error')).toContainText(
      'mp_maxrounds out of range'
    );
  });

  test('the Push tab keeps only fleet-wide items', async ({ page }) => {
    await page.goto('/manage/servers#fleet-settings');
    await expect(page.getByTestId('fleet-push-panel')).toBeVisible();
    await expect(page.getByTestId('fleet-default-plugins-edit')).toBeVisible();
    await expect(page.getByTestId('fleet-defaults-edit')).toBeVisible();
    await expect(page.getByTestId('fleet-push-servers')).toHaveCount(0);
    await expect(page.getByTestId('fleet-practice-a')).toHaveCount(0);
  });
});
