import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInAsPlayer, signInViaRequest } from '../helpers/auth';

/**
 * Catalogue unlock, from the inventory page: the Catalog view, the pick
 * dialog, and the Picked chip on the equipped row.
 *
 * @tag ui
 */

const STEAM_ID = '76561198099990003';

test.describe.serial('Skins catalogue picker', () => {
  const setConfig = (request: APIRequestContext, data: Record<string, unknown>) =>
    request.put('/api/skins/admin/config', { headers: getAuthHeader(), data });

  test.beforeEach(async ({ page, request }) => {
    await signInViaRequest(request);
    await setConfig(request, { enabled: true, catalogUnlocked: true });
    await signInAsPlayer(page, STEAM_ID, 'Catalog UI Tester');
    const catalog = await page.request.get('/api/skins/catalog?weapon=weapon_deagle');
    const skins = catalog.ok() ? ((await catalog.json()).skins ?? []) : [];
    test.skip(skins.length === 0, 'The skin catalogue could not be read');
    for (const slot of ['weapon_deagle', 'knife', 'gloves']) {
      await page.request.delete(`/api/skins/me/equip/${slot}`);
    }
  });

  test.afterAll(async ({ playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await signInViaRequest(admin);
    await setConfig(admin, { enabled: false, catalogUnlocked: false });
    await admin.dispose();
  });

  test(
    'a player picks a catalogue skin with a float and seed',
    { tag: ['@ui'] },
    async ({ page }) => {
      await page.goto('/inventory');
      await page.getByTestId('inventory-view').getByRole('button', { name: 'Catalog' }).click();
      await page.getByRole('searchbox').fill('deagle');
      await page.getByTestId('catalog-tile').filter({ hasText: 'Desert Eagle' }).first().click();

      const dialog = page.getByTestId('catalog-pick-dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Float').fill('0.05');
      await dialog.getByLabel('Pattern').fill('42');
      await dialog.getByRole('button', { name: 'Equip' }).click();
      await expect(dialog).toBeHidden();

      const picked = page.getByTestId('loadout-slot').filter({ hasText: 'Picked' });
      await expect(picked).toHaveCount(1);
      await expect(picked).toContainText('Desert Eagle');

      const me = await (await page.request.get('/api/skins/me')).json();
      expect(me.picks[0]).toMatchObject({ weapon: 'weapon_deagle', float: 0.05, pattern: 42 });
    }
  );

  test('every weapon has a slot in the loadout', { tag: ['@ui'] }, async ({ page }) => {
    await page.goto('/inventory');
    const slot = page.getByTestId('loadout-slot').filter({ hasText: 'AK-47' });
    await expect(slot).toHaveCount(1);
    await slot.click();
    await expect(
      page.getByTestId('inventory-view').getByRole('button', { name: 'Catalog' })
    ).toHaveAttribute('aria-pressed', 'true');
    const tiles = page.getByTestId('catalog-tile');
    await expect(tiles.first()).toBeVisible();
    const texts = await tiles.allTextContents();
    expect(texts.every((x) => x.includes('AK-47'))).toBe(true);
  });

  test('the loadout is a compact set of columns', { tag: ['@ui'] }, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/inventory');
    const section = page.getByRole('region', { name: 'Equipped' });
    await expect(page.getByTestId('loadout-slot').first()).toBeVisible();
    const box = await section.boundingBox();
    expect(box?.height).toBeLessThan(600);
    const columns = section.getByRole('heading', { level: 3 });
    await expect(columns).toHaveText(['Knife & gear', 'Pistols', 'SMGs', 'Rifles', 'Heavy']);
    const gear = section.getByTestId('loadout-column').first();
    await expect(gear.getByTestId('loadout-slot').filter({ hasText: 'Zeus' })).toHaveCount(1);
    await expect(
      section
        .getByTestId('loadout-column')
        .nth(1)
        .getByTestId('loadout-slot')
        .filter({ hasText: 'Zeus' })
    ).toHaveCount(0);

    await page.setViewportSize({ width: 375, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a loadout row unequips its pick', { tag: ['@ui'] }, async ({ page }) => {
    await page.goto('/inventory');
    await page.getByTestId('loadout-slot').filter({ hasText: 'Desert Eagle' }).click();
    await page.getByTestId('catalog-tile').first().click();
    await page.getByTestId('catalog-pick-dialog').getByRole('button', { name: 'Equip' }).click();
    await expect(page.getByTestId('catalog-pick-dialog')).toBeHidden();

    const row = page.getByTestId('loadout-slot').filter({ hasText: 'Picked' });
    await expect(row).toHaveCount(1);
    await page.getByRole('button', { name: 'Unequip Desert Eagle' }).click();
    await expect(page.getByTestId('loadout-slot').filter({ hasText: 'Picked' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Desert Eagle', exact: true })).toBeVisible();
    const me = await (await page.request.get('/api/skins/me')).json();
    expect(me.picks.some((p: { slot: string }) => p.slot === 'weapon_deagle')).toBe(false);
  });

  test(
    'the Catalog view is hidden while the mode is off',
    { tag: ['@ui'] },
    async ({ page, request }) => {
      await setConfig(request, { catalogUnlocked: false });
      await page.goto('/inventory');
      await expect(page.getByTestId('inventory-page')).toBeVisible();
      await expect(page.getByTestId('inventory-view')).toHaveCount(0);
    }
  );
});
