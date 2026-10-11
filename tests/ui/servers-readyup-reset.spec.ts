import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { fleetServer, stubFleet, stubFleetDetail } from '../helpers/fleetUi';

/**
 * Reset from a Ready Up server's row or its panel: a confirm that names the
 * match when there is one, one request however often it is pressed, and the
 * platform's error when it refuses.
 *
 * @tag ui
 * @tag fleet
 */

test.describe('Ready Up fleet: reset', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('reset asks first, sends once, and says what it did or why not', async ({ page }) => {
    const servers = [
      fleetServer('a', {
        availability: 'busy',
        availabilityReason: 'local_match',
        availabilityDetail: 'cup-final',
      }),
      fleetServer('b'),
    ];
    await stubFleet(page, servers);
    await stubFleetDetail(page, servers);
    let posts = 0;
    let answer: { status: number; json: unknown } = {
      status: 200,
      json: { ok: true, ended: 'local', settledMatchSlug: null },
    };
    await page.route(
      (url) => /\/api\/fleet\/servers\/[^/]+\/reset$/.test(url.pathname),
      async (route) => {
        posts += 1;
        await new Promise((r) => setTimeout(r, 300));
        await route.fulfill({ status: answer.status, json: answer.json });
      }
    );
    await page.goto('/manage/servers#fleet');
    await page.getByTestId('fleet-reset-a').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Reset ru-a?');
    await expect(dialog).toContainText('cup-final');
    const confirm = dialog.getByRole('button', { name: 'Reset' });
    await confirm.click();
    await confirm.click({ force: true }).catch(() => undefined);
    await expect(page.getByText('ru-a reset')).toBeVisible();
    expect(posts).toBe(1);

    answer = {
      status: 409,
      json: {
        ok: false,
        errorCode: 'unsupported',
        error: 'This Ready Up does not know reset yet: update it',
      },
    };
    // A free server has no Reset on its row; its panel has one.
    await expect(page.getByTestId('servers-list').getByTestId('fleet-reset-b')).toHaveCount(0);
    await page.getByTestId('server-row-r:b').click();
    await page.getByTestId('server-panel').getByTestId('fleet-reset-b').click();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByText('This Ready Up does not know reset yet: update it')).toBeVisible();
  });

  test('an offline server cannot be reset', async ({ page }) => {
    const servers = [fleetServer('off', { online: false })];
    await stubFleet(page, servers);
    await stubFleetDetail(page, servers);
    await page.goto('/manage/servers?server=r:off');
    await expect(page.getByTestId('server-panel').getByTestId('fleet-reset-off')).toBeDisabled();
  });
});
