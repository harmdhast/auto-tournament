import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * The Servers page has tabs: the server list, keys and enrollment, push,
 * automatic scaling, failover. A link to a fleet anchor (`#autoscale`,
 * `#fleet`, ...) selects its tab. One Add menu adds a machine or a Ready Up server.
 *
 * @tag ui
 * @tag servers
 */

test.describe('Servers page sections', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'the page has five tabs; links select a tab; Add offers a machine or a Ready Up server',
    { tag: ['@ui', '@servers'] },
    async ({ page }) => {
      await page.goto('/manage/servers');
      const tab = (name: string) => page.getByRole('tab', { name });
      await expect(page.getByRole('tab')).toHaveCount(5);
      await expect(tab('Servers')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('readyup-fleet')).toHaveCount(0);

      await page.getByTestId('servers-add').click();
      await expect(page.getByTestId('servers-add-machine')).toBeVisible();
      await page.getByTestId('servers-add-readyup').click();
      await expect(page.getByTestId('fleet-create-code')).toBeVisible();
      await page.keyboard.press('Escape');

      await tab('Keys and enrollment').click();
      await expect(page.getByTestId('fleet-panel')).toBeVisible();
      await expect(page.getByTestId('fleet-add-server')).toHaveCount(0);
      await expect(page.getByTestId('fleet-panel')).not.toContainText('Ready Up server(s)');

      await page.goto('/manage/servers#autoscale');
      await expect(tab('Automatic scaling')).toHaveAttribute('aria-selected', 'true');
      await page.goto('/manage/servers#fleet-settings');
      await expect(tab('Push')).toHaveAttribute('aria-selected', 'true');
      await page.goto('/manage/servers#fleet');
      await expect(tab('Servers')).toHaveAttribute('aria-selected', 'true');
      await page.goto('/manage/servers#failover');
      await expect(tab('Failover')).toHaveAttribute('aria-selected', 'true');
    }
  );
});
