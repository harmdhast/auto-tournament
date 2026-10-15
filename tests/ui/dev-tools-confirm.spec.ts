import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Development tools send the typed confirmation the destructive routes ask
 * for (routes/tournament.ts): wiping a table and resetting the simulation.
 *
 * @tag ui
 */

test(
  'wiping a table and resetting the simulation succeed from the dev tools',
  {
    tag: ['@ui'],
  },
  async ({ page }) => {
    expect(await signInViaRequest(page.request)).toBe(true);
    await page.goto('/manage/dev');
    await page.getByRole('button', { name: 'Wipe Specific Tables' }).click();
    page.once('dialog', (dialog) => void dialog.accept());
    const wipe = page.waitForResponse((r) => r.url().includes('/api/tournament/wipe-table/'));
    await page.getByRole('button', { name: 'Wipe Shuffle Players' }).click();
    expect((await wipe).status()).toBe(200);
    const reset = page.waitForResponse((r) =>
      r.url().includes('/api/tournament/dev/reset-simulation-state')
    );
    await page.getByRole('button', { name: /Reset Simulation State/ }).click();
    expect((await reset).status()).toBe(200);
  }
);
