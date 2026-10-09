import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * The Servers page: machines on top, then the Ready Up fleet section with its
 * tabs (servers, keys and enrollment, push, automatic scaling, failover). A
 * link to a fleet anchor (`#autoscale`, `#fleet`, ...) selects its tab.
 *
 * @tag ui
 * @tag servers
 */

test.describe('Servers page sections', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'the Ready Up fleet is a section with tabs; links select a tab',
    { tag: ['@ui', '@servers'] },
    async ({ page }) => {
      await page.goto('/manage/servers');
      await expect(page.getByTestId('machines-add')).toBeVisible();
      const section = page.getByTestId('readyup-fleet');
      await expect(section).toBeVisible();
      await expect(section.getByRole('tab')).toHaveCount(5);
      await expect(page.getByTestId('servers-settings-toggle')).toHaveCount(0);
      await expect(page.getByTestId('servers-settings')).toHaveCount(0);

      await section.getByRole('tab', { name: 'Keys and enrollment' }).click();
      await expect(page.getByTestId('fleet-add-server')).toBeVisible();
      await expect(page.getByTestId('fleet-toggle')).toHaveCount(0);

      await page.goto('/manage/servers#autoscale');
      await expect(
        page.getByTestId('readyup-fleet').getByRole('tab', { name: 'Automatic scaling' })
      ).toHaveAttribute('aria-selected', 'true');
      await page.goto('/manage/servers#fleet');
      await expect(
        page.getByTestId('readyup-fleet').getByRole('tab', { name: 'Servers' })
      ).toHaveAttribute('aria-selected', 'true');
      await page.goto('/manage/servers#failover');
      await expect(
        page.getByTestId('readyup-fleet').getByRole('tab', { name: 'Failover' })
      ).toHaveAttribute('aria-selected', 'true');
    }
  );
});
