import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { createTestServer, deleteServer } from '../helpers/servers';

/**
 * Server UI tests.
 *
 * Servers come only through csm now: the page has no "add a server by
 * address", and a server record added by address (here: through the API)
 * is not listed.
 *
 * @tag ui
 * @tag servers
 */

test.describe.serial('Server UI', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'a server added by address is not listed',
    {
      tag: ['@ui', '@servers'],
    },
    async ({ page, request }) => {
      const server = await createTestServer(request, 'ui');
      expect(server, 'creating a server through the API').toBeTruthy();

      await page.goto('/manage/servers');
      // Nothing on the page adds a server by address.
      await expect(page.getByTestId('servers-add')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('add-server-button')).toHaveCount(0);
      await expect(page.getByTestId('servers-add-existing')).toHaveCount(0);

      await expect(page.locator('[data-testid^="server-row-x:"]')).toHaveCount(0);
      await expect(page.getByText(server!.name)).toHaveCount(0);
      await deleteServer(request, server!.id);
    }
  );
});
