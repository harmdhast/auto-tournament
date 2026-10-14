import { test, expect, type APIRequestContext } from '@playwright/test';
import { db } from '../../api/src/config/database';
import { skinService } from '../../api/src/integrations/cs2/skins/skinService';
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
const DEAGLE = 'weapon_deagle';
const AK = 'weapon_ak47';

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
  let ak: Item[] = [];

  const setConfig = (request: APIRequestContext, data: Record<string, unknown>) =>
    request.put('/api/skins/admin/config', { headers: getAuthHeader(), data });
  const me = async () => (await player.get('/api/skins/me')).json();
  const put = (data: unknown) => player.put('/api/skins/me/picks', { data });
  const pickOf = (weapon: string, index: number, over: Record<string, unknown> = {}) => ({
    weapon,
    paintKit: (weapon === DEAGLE ? deagle : []).concat(ak)[index].paintKit,
    float: 0.25,
    seed: 7,
    team: 0,
    ...over,
  });
  const skinGone = async (id: number) =>
    (await player.get(`/api/skins/skin/${id}`)).status() === 404;
  const search = async (query: string) =>
    ((await (await player.get(`/api/skins/catalog?${query}`)).json()).skins ?? []) as Item[];

  test.beforeAll(async ({ playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await signInViaRequest(admin);
    await setConfig(admin, { enabled: true, catalogUnlocked: true });
    player = await playwright.request.newContext({ baseURL });
    await signInAsPlayerViaRequest(player, STEAM_ID, 'Catalog Tester');
    deagle = await search('weapon=weapon_deagle');
    ak = await search('weapon=weapon_ak47');
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
    const { weapons } = await (await player.get('/api/skins/catalog/weapons')).json();
    for (const { slot } of weapons) await player.delete(`/api/skins/me/equip/${slot}`);
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

  test('a pick equips with the chosen float and seed', { tag: ['@api'] }, async () => {
    const res = await put({ ...pickOf(DEAGLE, 0), float: 0.0123, seed: 661 });
    expect(res.status()).toBe(200);
    const { pick } = await res.json();
    expect(pick).toMatchObject({
      source: 'catalog',
      float: 0.0123,
      pattern: 661,
      stattrak: null,
      equipped: true,
      equippedSides: [0],
      slot: DEAGLE,
    });
    const body = await me();
    expect(body.inventory.some((s: { source: string }) => s.source === 'catalog')).toBe(false);
    expect(body.picks).toEqual([expect.objectContaining({ id: pick.id })]);
    const pub = await (await player.get(`/api/skins/players/${STEAM_ID}`)).json();
    expect(pub.picks).toEqual([expect.objectContaining({ id: pick.id })]);
  });

  test('picks are never StatTrak', { tag: ['@api'] }, async ({ request }) => {
    await setConfig(request, { statTrakChance: 100 });
    const { pick } = await (await put(pickOf(AK, 0))).json();
    await setConfig(request, { statTrakChance: 10 });
    expect(pick.stattrak).toBeNull();
  });

  test('one pick per side: both, then a side splits it', { tag: ['@api'] }, async () => {
    const both = (await (await put(pickOf(DEAGLE, 0))).json()).pick;
    const ct = (await (await put(pickOf(DEAGLE, 1, { team: 3 }))).json()).pick;
    let { picks } = await me();
    const sides = Object.fromEntries(
      picks.map((p: { id: number; equippedSides: number[] }) => [p.id, p.equippedSides])
    );
    expect(sides).toEqual({ [both.id]: [0], [ct.id]: [3] });

    // A T pick next to it: the both pick is shadowed on both sides.
    const t = (await (await put(pickOf(DEAGLE, 2, { team: 2 }))).json()).pick;
    expect(t.equippedSides).toEqual([2]);

    // The same side again replaces that side's pick only.
    const ct2 = (await (await put(pickOf(DEAGLE, 3, { team: 3 }))).json()).pick;
    expect(await skinGone(ct.id)).toBe(true);
    picks = (await me()).picks;
    expect(picks.map((p: { id: number }) => p.id).sort()).toEqual([both.id, t.id, ct2.id].sort());

    // A pick for both clears every side's.
    const all = (await (await put(pickOf(DEAGLE, 0, { float: 0.5 }))).json()).pick;
    expect((await me()).picks.map((p: { id: number }) => p.id)).toEqual([all.id]);
    expect(await skinGone(both.id)).toBe(true);
    expect(await skinGone(t.id)).toBe(true);
    expect(await skinGone(ct2.id)).toBe(true);
  });

  test('a one-side weapon is always picked for both', { tag: ['@api'] }, async () => {
    const { pick } = await (await put(pickOf(AK, 0, { team: 3 }))).json();
    expect(pick).toMatchObject({ side: 2, equippedSides: [0] });
  });

  test(
    'equipping an earned skin deletes the pick on that side',
    { tag: ['@api'] },
    async ({ request }) => {
      const given = await request.post(`/api/skins/admin/players/${STEAM_ID}/skins`, {
        headers: getAuthHeader(),
        data: { weapon: DEAGLE, paintKit: deagle[0].paintKit },
      });
      const { id } = await given.json();
      await player.delete(`/api/skins/me/equip/${DEAGLE}`);

      const ct = (await (await put(pickOf(DEAGLE, 1, { team: 3 }))).json()).pick;
      const t = (await (await put(pickOf(DEAGLE, 2, { team: 2 }))).json()).pick;
      await player.post('/api/skins/me/equip', { data: { skinId: id, team: 3 } });
      expect(await skinGone(ct.id)).toBe(true);
      expect((await me()).picks.map((p: { id: number }) => p.id)).toEqual([t.id]);

      await player.post('/api/skins/me/equip', { data: { skinId: id, team: 0 } });
      expect(await skinGone(t.id)).toBe(true);
      const body = await me();
      expect(body.picks).toEqual([]);
      expect(body.inventory.find((s: { id: number }) => s.id === id)).toMatchObject({
        equippedSides: [0],
      });
      await request.delete(`/api/skins/admin/skins/${id}`, { headers: getAuthHeader() });
    }
  );

  test('an earned skin never equips onto a pick id', { tag: ['@api'] }, async () => {
    const { pick } = await (await put(pickOf(DEAGLE, 0))).json();
    const res = await player.post('/api/skins/me/equip', { data: { skinId: pick.id } });
    expect(res.status()).toBe(404);
  });

  test('unequip deletes the pick on that side', { tag: ['@api'] }, async () => {
    const ct = (await (await put(pickOf(DEAGLE, 1, { team: 3 }))).json()).pick;
    const t = (await (await put(pickOf(DEAGLE, 2, { team: 2 }))).json()).pick;
    await player.delete(`/api/skins/me/equip/${DEAGLE}?team=3`);
    expect(await skinGone(ct.id)).toBe(true);
    expect((await me()).picks.map((p: { id: number }) => p.id)).toEqual([t.id]);
    await player.delete(`/api/skins/me/equip/${DEAGLE}`);
    expect(await skinGone(t.id)).toBe(true);
    expect((await me()).picks).toEqual([]);
  });

  test('picks stay hidden while the mode is off', { tag: ['@api'] }, async ({ request }) => {
    const { pick } = await (await put(pickOf(DEAGLE, 0))).json();
    await setConfig(request, { catalogUnlocked: false });
    expect((await me()).picks).toEqual([]);
    expect((await (await player.get(`/api/skins/players/${STEAM_ID}`)).json()).picks).toEqual([]);
    expect((await me()).inventory.some((s: { id: number }) => s.id === pick.id)).toBe(false);
    expect(await skinGone(pick.id)).toBe(true);
    expect((await put(pickOf(DEAGLE, 1))).status()).toBe(404);
    await setConfig(request, { catalogUnlocked: true });
    expect((await me()).picks).toEqual([expect.objectContaining({ id: pick.id })]);
    expect(await skinGone(pick.id)).toBe(false);
  });

  test('bad picks are refused and store nothing', { tag: ['@api'] }, async () => {
    const good = pickOf(DEAGLE, 0, { float: 0.2, seed: 6 });
    const { pick } = await (await put(good)).json();
    const bad = [
      { ...good, float: 1.5 },
      { ...good, float: -0.1 },
      { ...good, float: 'x' },
      { ...good, float: null },
      { ...good, seed: 1001 },
      { ...good, seed: 2.5 },
      { ...good, seed: -1 },
      { ...good, paintKit: 999999 },
      { ...good, weapon: 'weapon_nonexistent' },
      // In the catalogue, but the game plugin has no definition index for it.
      { weapon: 'weapon_decoy', paintKit: 9001, float: 0.1, seed: 1, team: 0 },
    ];
    for (const data of bad) expect((await put(data)).status(), JSON.stringify(data)).toBe(400);
    expect((await me()).picks).toEqual([expect.objectContaining({ id: pick.id })]);
  });

  test('the showcase ignores picks', { tag: ['@api'] }, async () => {
    const { pick } = await (await put(pickOf(DEAGLE, 0))).json();
    await player.put('/api/skins/me/showcase', {
      data: { items: [{ skinId: pick.id, big: true }] },
    });
    expect((await me()).showcase).toEqual([]);
  });

  test('admin views leave picks out', { tag: ['@api'] }, async ({ request }) => {
    const headers = getAuthHeader();
    const stats = async () =>
      await (await request.get('/api/skins/admin/stats', { headers })).json();
    const before = await stats();
    await put(pickOf(DEAGLE, 0));
    const after = await stats();
    expect(after.given).toBe(before.given);
    expect(after.playersWithSkins).toBe(before.playersWithSkins);
    expect(after.rarest?.name).toBe(before.rarest?.name);

    const earned = (await me()).inventory.length;
    const found = await (
      await request.get('/api/skins/admin/players?q=Catalog Tester', { headers })
    ).json();
    expect(found.players.find((p: { steamId: string }) => p.steamId === STEAM_ID).skins).toBe(
      earned
    );
    const inventory = await (
      await request.get(`/api/skins/admin/players/${STEAM_ID}/inventory`, { headers })
    ).json();
    expect(inventory.inventory.some((s: { source: string }) => s.source === 'catalog')).toBe(false);
  });

  test('a pick is no trade-up input', { tag: ['@api'] }, async ({ request }) => {
    const headers = getAuthHeader();
    await setConfig(request, { tradeUp: { enabled: true, count: 3 } });
    const commons = (await search('category=smgs')).filter(
      (s) => (s as { rarity?: string }).rarity === 'common'
    );
    expect(commons.length).toBeGreaterThanOrEqual(2);
    const ids: number[] = [];
    for (const c of commons.slice(0, 2)) {
      const given = await request.post(`/api/skins/admin/players/${STEAM_ID}/skins`, {
        headers,
        data: { weapon: c.weapon, paintKit: c.paintKit },
      });
      ids.push((await given.json()).id);
    }
    // A common pick like the two commons it would complete the contract with.
    const common = (await search('category=pistols')).find(
      (s) => (s as { rarity?: string }).rarity === 'common' && s.side === null
    )!;
    const { pick } = await (
      await put({ weapon: common.weapon, paintKit: common.paintKit, float: 0.3, seed: 3, team: 0 })
    ).json();
    expect(pick.rarity).toBe('common');
    const res = await player.post('/api/skins/me/trade-up', {
      data: { skinIds: [...ids, pick.id] },
    });
    expect(res.status()).toBe(400);
    expect((await me()).picks).toEqual([expect.objectContaining({ id: pick.id })]);
    expect((await me()).inventory.filter((s: { id: number }) => ids.includes(s.id))).toHaveLength(
      2
    );
    for (const id of ids) await request.delete(`/api/skins/admin/skins/${id}`, { headers });
  });
});

test.describe('catalogue picks in the server loadout', () => {
  const restore: Array<() => void> = [];
  const stub = <K extends 'getAppSettingAsync' | 'queryOneAsync' | 'queryAsync'>(
    key: K,
    value: (typeof db)[K]
  ) => {
    const original = db[key];
    db[key] = value;
    restore.push(() => {
      db[key] = original;
    });
  };
  test.afterEach(() => {
    while (restore.length) restore.pop()!();
  });

  async function readLoadout(config: Record<string, unknown>) {
    let flag: unknown = 'unset';
    stub('getAppSettingAsync', (async () =>
      JSON.stringify(config)) as typeof db.getAppSettingAsync);
    stub('queryOneAsync', (async () => ({ uid: 'u1' })) as typeof db.queryOneAsync);
    stub('queryAsync', (async (_sql: string, params: unknown[] = []) => {
      flag = params[1];
      return [];
    }) as typeof db.queryAsync);
    await skinService.loadoutItems(STEAM_ID);
    return flag;
  }

  test('the push leaves picks out while the mode is off', { tag: ['@api'] }, async () => {
    expect(await readLoadout({ enabled: true, catalogUnlocked: false })).toBe(false);
    expect(await readLoadout({ enabled: true, catalogUnlocked: true })).toBe(true);
  });
});
