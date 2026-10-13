import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Catalogue unlock: with the mode on, a player equips any catalogue skin with
 * a float and seed they choose. A pick is not an earned skin: one per slot,
 * never in the inventory, showcase or admin counts.
 *
 * @tag api
 */

const STEAM_ID = '76561198099990002';
const WEAPON = 'weapon_deagle';

interface Item {
  weapon: string;
  paintKit: number;
}

test.describe.serial('Skins catalogue unlock', () => {
  let player: APIRequestContext;
  let skins: Item[] = [];

  const setConfig = (request: APIRequestContext, data: Record<string, unknown>) =>
    request.put('/api/skins/admin/config', { headers: getAuthHeader(), data });
  const me = async () => (await player.get('/api/skins/me')).json();
  const put = (data: unknown) => player.put('/api/skins/me/picks', { data });

  test.beforeAll(async ({ playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await signInViaRequest(admin);
    await setConfig(admin, { enabled: true, catalogUnlocked: true });
    player = await playwright.request.newContext({ baseURL });
    await signInAsPlayerViaRequest(player, STEAM_ID, 'Catalog Tester');
    const catalog = await player.get(`/api/skins/catalog?weapon=${WEAPON}`);
    if (catalog.ok()) skins = ((await catalog.json()).skins ?? []) as Item[];
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
    test.skip(skins.length < 2, 'The skin catalogue could not be read');
    await signInViaRequest(request);
    await setConfig(request, { enabled: true, catalogUnlocked: true });
    // Start each test with no pick.
    await player.delete(`/api/skins/me/equip/${WEAPON}`);
  });

  test('status reports the mode', { tag: ['@api'] }, async ({ request }) => {
    expect(await (await player.get('/api/skins/status')).json()).toMatchObject({ enabled: true, catalogUnlocked: true });
    await setConfig(request, { enabled: false, catalogUnlocked: true });
    expect(await (await player.get('/api/skins/status')).json()).toMatchObject({ enabled: false, catalogUnlocked: false });
  });

  test('category filters on the server before the cap', { tag: ['@api'] }, async () => {
    const res = await player.get('/api/skins/catalog?category=knives');
    expect(res.status()).toBe(200);
    const knives = ((await res.json()).skins ?? []) as { slot: string }[];
    expect(knives.length).toBeGreaterThan(0);
    expect(knives.every((s) => s.slot === 'knife')).toBe(true);
  });

  test('weapons list covers every slot', { tag: ['@api'] }, async ({ request }) => {
    await setConfig(request, { catalogUnlocked: false });
    expect((await player.get('/api/skins/catalog/weapons')).status()).toBe(404);
    await setConfig(request, { catalogUnlocked: true });
    const res = await player.get('/api/skins/catalog/weapons');
    expect(res.status()).toBe(200);
    const weapons = ((await res.json()).weapons ?? []) as { weapon: string; slot: string; category: string }[];
    const slots = weapons.map((w) => w.slot);
    expect(new Set(slots).size).toBe(slots.length);
    const by = (slot: string) => weapons.find((w) => w.slot === slot);
    expect(by('knife')).toMatchObject({ category: 'knives' });
    expect(by('gloves')).toMatchObject({ category: 'gloves' });
    expect(by('weapon_ak47')).toMatchObject({ category: 'rifles' });
    expect(by('weapon_deagle')).toMatchObject({ category: 'pistols' });
    expect(slots.slice(0, 2)).toEqual(['knife', 'gloves']);
  });

  test('catalogue is closed while the mode is off', { tag: ['@api'] }, async ({ request }) => {
    await setConfig(request, { catalogUnlocked: false });
    expect((await player.get('/api/skins/catalog')).status()).toBe(404);
    expect((await put({ weapon: WEAPON, paintKit: skins[0].paintKit, float: 0.1, pattern: 1 })).status()).toBe(404);
  });

  test('pick equips with the chosen float and seed', { tag: ['@api'] }, async () => {
    const res = await put({ weapon: WEAPON, paintKit: skins[0].paintKit, float: 0.0123, pattern: 661 });
    expect(res.status()).toBe(200);
    const { pick } = await res.json();
    expect(pick).toMatchObject({ source: 'catalog', float: 0.0123, pattern: 661, equipped: true, slot: WEAPON });

    const body = await me();
    expect(body.inventory.some((s: { source: string }) => s.source === 'catalog')).toBe(false);
    expect(body.picks).toEqual([expect.objectContaining({ id: pick.id })]);

    const pub = await (await player.get(`/api/skins/players/${STEAM_ID}`)).json();
    expect(pub.picks).toEqual([expect.objectContaining({ id: pick.id })]);
  });

  test('one pick per slot', { tag: ['@api'] }, async () => {
    const first = (await (await put({ weapon: WEAPON, paintKit: skins[0].paintKit, float: 0.5, pattern: 1 })).json()).pick;
    const second = (await (await put({ weapon: WEAPON, paintKit: skins[1].paintKit, float: 0.25, pattern: 2 })).json()).pick;
    const { picks } = await me();
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ id: second.id, float: 0.25, pattern: 2 });
    expect((await player.get(`/api/skins/skin/${first.id}`)).status()).toBe(404);
  });

  test('a pick replaces an equipped earned skin', { tag: ['@api'] }, async ({ request }) => {
    const given = await request.post(`/api/skins/admin/players/${STEAM_ID}/skins`, {
      headers: getAuthHeader(),
      data: { weapon: WEAPON, paintKit: skins[0].paintKit },
    });
    const { id } = await given.json();
    await player.delete(`/api/skins/me/equip/${WEAPON}`);
    await player.post('/api/skins/me/equip', { data: { skinId: id } });

    await put({ weapon: WEAPON, paintKit: skins[1].paintKit, float: 0.3, pattern: 3 });
    let body = await me();
    expect(body.inventory.find((s: { id: number }) => s.id === id)).toMatchObject({ equipped: false });
    expect(body.picks).toHaveLength(1);

    await player.post('/api/skins/me/equip', { data: { skinId: id } });
    body = await me();
    expect(body.picks).toEqual([]);
    expect(body.inventory.find((s: { id: number }) => s.id === id)).toMatchObject({ equipped: true });

    await request.delete(`/api/skins/admin/skins/${id}`, { headers: getAuthHeader() });
  });

  test('unequip deletes the pick', { tag: ['@api'] }, async () => {
    const { pick } = await (await put({ weapon: WEAPON, paintKit: skins[0].paintKit, float: 0.4, pattern: 4 })).json();
    await player.delete(`/api/skins/me/equip/${WEAPON}`);
    expect((await me()).picks).toEqual([]);
    expect((await player.get(`/api/skins/skin/${pick.id}`)).status()).toBe(404);
  });

  test('picks hidden while the mode is off', { tag: ['@api'] }, async ({ request }) => {
    const { pick } = await (await put({ weapon: WEAPON, paintKit: skins[0].paintKit, float: 0.6, pattern: 5 })).json();
    await setConfig(request, { catalogUnlocked: false });
    expect((await me()).picks).toEqual([]);
    expect((await (await player.get(`/api/skins/players/${STEAM_ID}`)).json()).picks).toEqual([]);
    expect((await player.get(`/api/skins/skin/${pick.id}`)).status()).toBe(404);
    await setConfig(request, { catalogUnlocked: true });
    expect((await me()).picks).toEqual([expect.objectContaining({ id: pick.id })]);
    expect((await player.get(`/api/skins/skin/${pick.id}`)).status()).toBe(200);
  });

  test('bad picks are refused', { tag: ['@api'] }, async () => {
    const good = { weapon: WEAPON, paintKit: skins[0].paintKit, float: 0.2, pattern: 6 };
    const { pick } = await (await put(good)).json();
    const bad = [
      { ...good, float: 1.5 },
      { ...good, float: -0.1 },
      { ...good, float: 'x' },
      { ...good, pattern: 1001 },
      { ...good, pattern: 2.5 },
      { ...good, pattern: -1 },
      { ...good, paintKit: 999999 },
    ];
    for (const data of bad) expect((await put(data)).status()).toBe(400);
    expect((await me()).picks).toEqual([expect.objectContaining({ id: pick.id })]);
  });

  test('showcase ignores picks', { tag: ['@api'] }, async () => {
    const { pick } = await (await put({ weapon: WEAPON, paintKit: skins[0].paintKit, float: 0.7, pattern: 7 })).json();
    await player.put('/api/skins/me/showcase', { data: { items: [{ skinId: pick.id, big: true }] } });
    expect((await me()).showcase).toEqual([]);
  });

  test('admin views leave picks out', { tag: ['@api'] }, async ({ request }) => {
    await put({ weapon: WEAPON, paintKit: skins[0].paintKit, float: 0.8, pattern: 8 });
    const earned = (await me()).inventory.length;
    const found = await (
      await request.get('/api/skins/admin/players?q=Catalog Tester', { headers: getAuthHeader() })
    ).json();
    const row = found.players.find((p: { steamId: string }) => p.steamId === STEAM_ID);
    expect(row.skins).toBe(earned);
  });
});
