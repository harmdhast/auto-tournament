import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { fleetServer, stubFleet, stubFleetDetail } from '../helpers/fleetUi';

/**
 * A Ready Up server's panel lists who is on it, and an admin can kick one,
 * with an optional message.
 *
 * @tag ui
 * @tag fleet
 */

test.describe('Ready Up fleet: players', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('kick a player from the panel, with a message', async ({ page }) => {
    const players = [
      { steamid64: '76561198000100001', name: 'alice', team: 'ct' },
      { steamid64: '76561198000100002', name: 'bob', team: 't' },
    ];
    const servers = [fleetServer('a', { players }), fleetServer('b')];
    await stubFleet(page, servers);
    await stubFleetDetail(page, servers);
    let body: unknown = null;
    await page.route(
      (url) => /\/api\/fleet\/servers\/a\/kick$/.test(url.pathname),
      async (route) => {
        body = route.request().postDataJSON();
        await route.fulfill({ json: { ok: true } });
      }
    );
    await page.goto('/manage/servers?server=r:a#fleet');
    const sheet = page.getByTestId('server-panel');
    await expect(sheet.getByTestId('fleet-player-76561198000100001')).toContainText('alice');
    await sheet.getByTestId('fleet-kick-76561198000100002').click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toContainText('Kick bob?');
    await dialog.getByLabel('Message shown on kick (optional)').fill('afk');
    await dialog.getByRole('button', { name: 'Kick' }).click();
    await expect(page.getByText('bob kicked')).toBeVisible();
    expect(body).toEqual({ steamid64: '76561198000100002', message: 'afk' });

    await page.goto('/manage/servers?server=r:b#fleet');
    await expect(page.getByTestId('server-panel')).toContainText('Nobody on the server');
  });
});
