import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Settings UI tests
 * Tests settings page functionality
 *
 * NOTE: the Steam API key is no longer editable here — it is supplied via the
 * STEAM_API_KEY environment variable (see example.env). These tests previously
 * asserted a `settings-steam-api-key-input` field that no longer exists.
 *
 * @tag ui
 * @tag settings
 * @tag configuration
 */

test.describe.serial('Settings UI', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test(
    'should navigate to and display settings page',
    {
      tag: ['@ui', '@settings'],
    },
    async ({ page }) => {
      await page.goto('/manage/settings');
      await expect(page).toHaveURL(/\/settings/);
      await expect(page).toHaveTitle(/Settings/i);
      await page.waitForLoadState('networkidle');

      // One page: the platform's cards, no second nav and nothing of CS2's.
      for (const card of ['site', 'signin', 'players', 'webhooks', 'advanced']) {
        await expect(page.getByTestId(`settings-card-${card}`)).toBeVisible({ timeout: 15000 });
      }
      await expect(page.locator('[id^="settings-nav-"]')).toHaveCount(0);
      await expect(page.getByTestId('settings-webhook-url-input')).toHaveCount(0);

      // CS2's settings are its Match rules page, linked from here.
      await page
        .getByTestId('settings-game-links')
        .getByRole('link', { name: 'Match rules' })
        .click();
      await expect(page).toHaveURL(/\/match-rules$/);
      await expect(page.getByTestId('cs2-server-defaults')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('settings-webhook-url-input')).toHaveCount(0);
      await expect(page.getByTestId('cs2-settings-reset-button')).toBeVisible();

      // The Steam API key is env-only; a field here would mean a secret is being
      // round-tripped through the browser.
      await expect(page.getByTestId('settings-steam-api-key-input')).toHaveCount(0);
    }
  );

  test(
    'a CS2 server default saves on its own, and the CS2 reset clears it',
    {
      tag: ['@ui', '@settings', '@configuration'],
    },
    async ({ page }) => {
      const readSettings = async () =>
        (await (await page.request.get('/api/settings')).json()).settings as Record<
          string,
          unknown
        >;

      // A field the tab does not touch, to prove its saves are partial.
      const before = await readSettings();

      await page.goto('/manage/match-rules');
      const veto = page.getByTestId('setting-veto-turn-seconds').locator('input');
      await expect(veto).toBeVisible({ timeout: 30000 });

      const value = 31 + (Date.now() % 20);
      await veto.fill(String(value));
      await veto.blur();

      await expect
        .poll(async () => (await readSettings()).vetoTurnSeconds, {
          message: 'veto seconds to be saved',
          timeout: 15000,
        })
        .toBe(value);
      expect((await readSettings()).ratingsEnabled).toBe(before.ratingsEnabled);

      await page.getByTestId('cs2-settings-reset-button').click();
      await page.getByTestId('cs2-settings-reset-confirm').click();
      await expect
        .poll(async () => (await readSettings()).vetoTurnSeconds, {
          message: 'veto seconds to be reset',
          timeout: 15000,
        })
        .not.toBe(value);
      await expect(veto).toHaveValue('45');
    }
  );
});
