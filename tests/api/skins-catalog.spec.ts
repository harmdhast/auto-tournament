import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Catalogue unlock: with the mode on, a player equips any catalogue skin with
 * a float and seed they choose, per side like earned skins. A pick is not an
 * earned skin: never in the inventory, showcase, trade-ups or admin counts.
 * The catalogue is the fixture in tests/fixtures/skins (SKINS_JSON_URL).
 *
 * @tag api
 */

const STEAM_ID = '76561198099990002';

interface Item {
  weapon: string;
  paintKit: number;
  slot: string;
  side: 2 | 3 | null;
  category?: string;
}

test.describe.serial('Skins catalogue unlock', () => {
  let player: APIRequestContext;
  let deagle: Item[] = [];

  const setConfig = (request: APIRequestContext, data: Record<string, unknown>) =>
    request.put('/api/skins/admin/config', { headers: getAuthHeader(), data });
  const me = async () => (await player.get('/api/skins/me')).json();
  const put = (data: unknown) => player.put('/api/skins/me/picks', { data });
  const search = async (query: string) =>
    ((await (await player.get(`/api/skins/catalog?${query}`)).json()).skins ?? []) as Item[];

  test.beforeAll(async ({ playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await signInViaRequest(admin);
    await setConfig(admin, { enabled: true, catalogUnlocked: true });
    player = await playwright.request.newContext({ baseURL });
    await signInAsPlayerViaRequest(player, STEAM_ID, 'Catalog Tester');
    deagle = await search('weapon=weapon_deagle');
    await admin.dispose();
  });

  test.afterAll(async ({ playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await signInViaRequest(admin);
    await setConfig(admin, { enabled: false, catalogUnlocked: false });
    await admin.dispose();
    await player.dispose();
  });

  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    await setConfig(request, { enabled: true, catalogUnlocked: true });
    for (const slot of ['weapon_deagle', 'weapon_ak47', 'knife', 'gloves', 'weapon_taser']) {
      await player.delete(`/api/skins/me/equip/${slot}`);
    }
  });

  test('status reports the mode', { tag: ['@api'] }, async ({ request }) => {
    expect(await (await player.get('/api/skins/status')).json()).toMatchObject({
      enabled: true,
      catalogUnlocked: true,
    });
    await setConfig(request, { enabled: false, catalogUnlocked: true });
    expect(await (await player.get('/api/skins/status')).json()).toMatchObject({
      enabled: false,
      catalogUnlocked: false,
    });
  });

  test('catalogue is closed while the mode is off', { tag: ['@api'] }, async ({ request }) => {
    expect(deagle.length).toBeGreaterThan(1);
    await setConfig(request, { catalogUnlocked: false });
    expect((await player.get('/api/skins/catalog')).status()).toBe(404);
    expect((await player.get('/api/skins/catalog/weapons')).status()).toBe(404);
  });

  test('search carries the side and the slot', { tag: ['@api'] }, async () => {
    expect(deagle.every((s) => s.weapon === 'weapon_deagle' && s.side === null)).toBe(true);
    const ak = await search('weapon=weapon_ak47');
    expect(ak.length).toBeGreaterThan(0);
    expect(ak.every((s) => s.side === 2 && s.slot === 'weapon_ak47')).toBe(true);
  });

  test('category filters on the server before the cap', { tag: ['@api'] }, async () => {
    const knives = await search('category=knives');
    expect(knives.length).toBeGreaterThan(0);
    expect(knives.every((s) => s.slot === 'knife')).toBe(true);
    const gloves = await search('category=gloves');
    expect(gloves.length).toBeGreaterThan(0);
    expect(gloves.every((s) => s.slot === 'gloves')).toBe(true);
    // The Zeus sits with the pistols.
    const pistols = await search('category=pistols');
    expect(pistols.some((s) => s.weapon === 'weapon_taser')).toBe(true);
    expect(pistols.some((s) => s.weapon === 'weapon_deagle')).toBe(true);
    expect(pistols.some((s) => s.weapon === 'weapon_ak47')).toBe(false);
  });

  test('weapons list covers every slot', { tag: ['@api'] }, async () => {
    const res = await player.get('/api/skins/catalog/weapons');
    expect(res.status()).toBe(200);
    const weapons = ((await res.json()).weapons ?? []) as Array<Item & { weaponName: string }>;
    const slots = weapons.map((w) => w.slot);
    expect(new Set(slots).size).toBe(slots.length);
    const by = (slot: string) => weapons.find((w) => w.slot === slot);
    expect(by('knife')).toMatchObject({ category: 'knives', weaponName: 'Knife', side: null });
    expect(by('gloves')).toMatchObject({ category: 'gloves', weaponName: 'Gloves', side: null });
    expect(by('weapon_ak47')).toMatchObject({ category: 'rifles', side: 2 });
    expect(by('weapon_deagle')).toMatchObject({ category: 'pistols', side: null });
    expect(by('weapon_taser')).toMatchObject({ category: 'pistols' });
    expect(slots.slice(0, 2)).toEqual(['knife', 'gloves']);
  });
});
