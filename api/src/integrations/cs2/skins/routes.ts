/**
 * Virtual skins: a player's inventory and loadout, other players' showcases,
 * and the admin settings. Every player route answers 404 while skins are off.
 *
 * GET    /status                   public: on or off, and whether the catalogue is unlocked
 * GET    /me                       signed in: your inventory, showcase, picks and new skins
 * GET    /catalog?q=&weapon=&category=  signed in: search the catalogue (while it is unlocked)
 * GET    /catalog/weapons          signed in: every weapon slot (while the catalogue is unlocked)
 * PUT    /me/picks                 equip any catalogue skin ({ weapon, paintKit, float, pattern })
 * POST   /me/equip                 equip a skin ({ skinId })
 * DELETE /me/equip/:slot           empty a slot
 * POST   /me/seen                  the "new skin" reveal was shown ({ ids })
 * PUT    /me/showcase              the profile showcase ({ items: [{ skinId, big }] })
 * GET    /players/:steamId         public: a player's skins
 * GET    /skin/:id                 public: one skin and its owner
 * GET    /admin/config, PUT        admin: the settings
 * GET    /admin/catalog?q=         admin: search the catalogue (for picking a reward)
 */

import { db } from '../../../config/database';
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { resolveViewerAccount } from '../../../utils/viewerIdentity';
import { skinImageUrls } from '../assets/localAssets';
import {
  SkinError,
  skinService,
  slotOf,
  variantOf,
  type CatalogSkin,
  type SkinsConfig,
} from './skinService';

const router = Router();

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof SkinError)
    return res.status(error.status).json({ success: false, error: error.message });
  log.error(`[Skins] ${what} failed`, { error });
  return res.status(500).json({ success: false, error: `${what} failed` });
}

/** The signed-in player's account, while skins are on; otherwise the answer is already sent. */
/** A loadout changed: a player in a match right now sees it in game at once. */
async function loadoutChanged(uid: string): Promise<void> {
  const row = await db.queryOneAsync<{ id: string }>('SELECT id FROM players WHERE uid = ?', [uid]);
  if (!row) return;
  const { pushLoadoutLive } = await import('../fleet/push/skins');
  await pushLoadoutLive(row.id);
}

async function playerOrStop(req: Request, res: Response): Promise<string | null> {
  if (!(await skinService.config()).enabled) {
    res.status(404).json({ success: false, error: 'Skins are off' });
    return null;
  }
  const viewer = await resolveViewerAccount(req);
  if (!viewer.uid) {
    res.status(401).json({ success: false, error: 'Sign in first' });
    return null;
  }
  if (viewer.isImpersonating) {
    res.status(403).json({ success: false, error: 'Stop impersonating to change a loadout.' });
    return null;
  }
  return viewer.uid;
}

const PISTOLS = [
  'glock',
  'hkp2000',
  'usp_silencer',
  'p250',
  'fiveseven',
  'tec9',
  'cz75a',
  'deagle',
  'revolver',
  'taser',
  'elite',
];
const SMGS = ['mac10', 'mp9', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon'];
const HEAVY = ['nova', 'xm1014', 'sawedoff', 'mag7', 'm249', 'negev'];

/** The weapon group a catalogue chip filters on (same groups as the inventory page). */
function categoryOf(weapon: string): string {
  const slot = slotOf(weapon);
  if (slot === 'knife') return 'knives';
  if (slot === 'gloves') return 'gloves';
  const w = weapon.replace('weapon_', '');
  if (PISTOLS.includes(w)) return 'pistols';
  if (SMGS.includes(w)) return 'smgs';
  if (HEAVY.includes(w)) return 'heavy';
  return 'rifles';
}

/**
 * Catalogue skins matching the words of `q`, one row per paint kit (`all`) or
 * per name, each with its variant and images.
 */
function searchCatalog(catalog: CatalogSkin[], q: unknown, all: boolean) {
  const words = String(q ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const seen = new Set<string>();
  return catalog
    .map((s) => ({ ...s, variant: variantOf(s.paintKitName), ...skinImageUrls(s.image) }))
    .filter((s) => {
      const text = `${s.weaponName} ${s.name} ${s.variant ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .filter((s) => {
      const key = all ? `${s.weapon}|${s.paintKit}` : `${s.weapon}|${s.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * @openapi
 * /api/skins/status:
 *   get:
 *     tags: [Skins]
 *     summary: Whether virtual skins are on, and the catalogue unlocked (public)
 *     responses:
 *       200: { description: "{ enabled, catalogUnlocked }" }
 */
router.get('/status', async (_req, res) => {
  try {
    const config = await skinService.config();
    return res.json({
      success: true,
      enabled: config.enabled,
      catalogUnlocked: config.enabled && config.catalogUnlocked,
    });
  } catch (error) {
    return fail(res, error, 'Reading the skins status');
  }
});

/**
 * @openapi
 * /api/skins/me:
 *   get:
 *     tags: [Skins]
 *     summary: Your inventory, showcase, catalogue picks, and skins you have not seen yet
 *     responses:
 *       200: { description: The inventory }
 *       401: { description: Not signed in }
 *       404: { description: Skins are off }
 */
router.get('/me', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    const inventory = await skinService.inventory(uid);
    return res.json({
      success: true,
      inventory,
      showcase: await skinService.showcase(uid),
      picks: await skinService.picks(uid),
      unseen: inventory.filter((s) => !s.seen).map((s) => s.id),
    });
  } catch (error) {
    return fail(res, error, 'Reading the inventory');
  }
});

/**
 * @openapi
 * /api/skins/me/equip:
 *   post:
 *     tags: [Skins]
 *     summary: Equip a skin in its slot
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { skinId: { type: integer } } }
 *     responses:
 *       200: { description: Equipped }
 *       404: { description: Not in your inventory, or skins are off }
 */
router.post('/me/equip', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    await skinService.equip(uid, Number(req.body?.skinId));
    void loadoutChanged(uid);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Equipping');
  }
});

/**
 * @openapi
 * /api/skins/me/equip/{slot}:
 *   delete:
 *     tags: [Skins]
 *     summary: Empty a loadout slot
 *     parameters:
 *       - { in: path, name: slot, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Emptied }
 */
router.delete('/me/equip/:slot', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    await skinService.unequip(uid, req.params.slot);
    void loadoutChanged(uid);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Unequipping');
  }
});

/**
 * @openapi
 * /api/skins/me/seen:
 *   post:
 *     tags: [Skins]
 *     summary: Mark new skins as seen
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { ids: { type: array, items: { type: integer } } } }
 *     responses:
 *       200: { description: Marked }
 */
router.post('/me/seen', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(Number).filter(Number.isInteger)
      : [];
    await skinService.markSeen(uid, ids);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Marking skins seen');
  }
});

/**
 * @openapi
 * /api/skins/me/showcase:
 *   put:
 *     tags: [Skins]
 *     summary: Arrange the profile showcase (up to 8 skins, some big)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               items:
 *                 type: array
 *                 items: { type: object, properties: { skinId: { type: integer }, big: { type: boolean } } }
 *     responses:
 *       200: { description: Saved }
 */
router.put('/me/showcase', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    await skinService.setShowcase(uid, Array.isArray(req.body?.items) ? req.body.items : []);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Saving the showcase');
  }
});

const CATEGORY_ORDER = ['knives', 'gloves', 'pistols', 'smgs', 'rifles', 'heavy'];

/**
 * @openapi
 * /api/skins/catalog/weapons:
 *   get:
 *     tags: [Skins]
 *     summary: Every weapon slot of the catalogue (while it is unlocked)
 *     responses:
 *       200: { description: "{ weapons: [{ weapon, weaponName, slot, category }] }, knife and gloves first" }
 *       401: { description: Not signed in }
 *       404: { description: The catalogue is not unlocked }
 */
router.get('/catalog/weapons', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    if (!(await skinService.catalogOn()))
      return res.status(404).json({ success: false, error: 'The catalogue is not unlocked' });
    const bySlot = new Map<
      string,
      { weapon: string; weaponName: string; slot: string; category: string }
    >();
    bySlot.set('knife', {
      weapon: 'knife',
      weaponName: 'Knife',
      slot: 'knife',
      category: 'knives',
    });
    bySlot.set('gloves', {
      weapon: 'gloves',
      weaponName: 'Gloves',
      slot: 'gloves',
      category: 'gloves',
    });
    for (const s of await skinService.catalog()) {
      const slot = slotOf(s.weapon);
      if (!bySlot.has(slot))
        bySlot.set(slot, {
          weapon: s.weapon,
          weaponName: s.weaponName,
          slot,
          category: categoryOf(s.weapon),
        });
    }
    const weapons = [...bySlot.values()].sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        a.weaponName.localeCompare(b.weaponName)
    );
    return res.json({ success: true, weapons });
  } catch (error) {
    return fail(res, error, 'Listing the weapons');
  }
});

/**
 * @openapi
 * /api/skins/catalog:
 *   get:
 *     tags: [Skins]
 *     summary: Search the catalogue to pick a skin (while it is unlocked)
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: weapon, schema: { type: string }, description: Only this weapon }
 *       - { in: query, name: category, schema: { type: string, enum: [rifles, pistols, smgs, heavy, knives, gloves] }, description: Only this weapon group }
 *     responses:
 *       200: { description: Up to 60 skins, one per paint kit }
 *       401: { description: Not signed in }
 *       404: { description: The catalogue is not unlocked }
 */
router.get('/catalog', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    if (!(await skinService.catalogOn()))
      return res.status(404).json({ success: false, error: 'The catalogue is not unlocked' });
    const weapon = typeof req.query.weapon === 'string' ? req.query.weapon : '';
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const skins = searchCatalog(await skinService.catalog(), req.query.q, true)
      .filter((s) => !weapon || s.weapon === weapon)
      .filter((s) => !category || categoryOf(s.weapon) === category)
      .slice(0, 60)
      .map((s) => ({
        weapon: s.weapon,
        weaponName: s.weaponName,
        paintKit: s.paintKit,
        name: s.name,
        rarity: s.rarity,
        variant: s.variant,
        slot: slotOf(s.weapon),
        imageUrl: s.imageUrl,
        imageSmallUrl: s.imageSmallUrl,
      }));
    return res.json({ success: true, skins });
  } catch (error) {
    return fail(res, error, 'Searching the catalogue');
  }
});

/**
 * @openapi
 * /api/skins/me/picks:
 *   put:
 *     tags: [Skins]
 *     summary: Equip any catalogue skin with a chosen float and pattern
 *     description: Replaces your pick in that slot. Only while the catalogue is unlocked.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [weapon, paintKit, float, pattern]
 *             properties:
 *               weapon: { type: string }
 *               paintKit: { type: integer }
 *               float: { type: number, minimum: 0, maximum: 1 }
 *               pattern: { type: integer, minimum: 0, maximum: 1000 }
 *     responses:
 *       200: { description: The equipped pick }
 *       400: { description: Not in the catalogue, or float or pattern out of range }
 *       404: { description: The catalogue is not unlocked }
 */
router.put('/me/picks', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const pick = await skinService.pick(uid, {
      weapon: String(body.weapon ?? ''),
      paintKit: Number(body.paintKit),
      float: body.float,
      pattern: body.pattern,
    });
    void loadoutChanged(uid);
    return res.json({ success: true, pick });
  } catch (error) {
    return fail(res, error, 'Equipping a pick');
  }
});

/**
 * @openapi
 * /api/skins/players/{steamId}:
 *   get:
 *     tags: [Skins]
 *     summary: A player's skins (public)
 *     parameters:
 *       - { in: path, name: steamId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Inventory, showcase and catalogue picks }
 *       404: { description: Skins are off, or no such player }
 */
router.get('/players/:steamId', async (req, res) => {
  try {
    if (!(await skinService.config()).enabled)
      return res.status(404).json({ success: false, error: 'Skins are off' });
    const profile = await skinService.publicProfile(req.params.steamId);
    if (!profile) return res.status(404).json({ success: false, error: 'No such player' });
    return res.json({ success: true, ...profile });
  } catch (error) {
    return fail(res, error, "Reading a player's skins");
  }
});

/**
 * @openapi
 * /api/skins/skin/{id}:
 *   get:
 *     tags: [Skins]
 *     summary: One skin and its owner (public)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: The skin }
 *       404: { description: No such skin, or skins are off }
 */
router.get('/skin/:id', async (req, res) => {
  try {
    if (!(await skinService.config()).enabled)
      return res.status(404).json({ success: false, error: 'Skins are off' });
    return res.json({ success: true, ...(await skinService.one(Number(req.params.id))) });
  } catch (error) {
    return fail(res, error, 'Reading a skin');
  }
});

/**
 * @openapi
 * /api/skins/admin/config:
 *   get:
 *     tags: [Skins]
 *     summary: The skins settings (admin)
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: The settings }
 *   put:
 *     tags: [Skins]
 *     summary: Change the skins settings (admin)
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200: { description: The saved settings }
 */
router.get('/admin/config', requireAuth, async (_req, res) => {
  try {
    return res.json({ success: true, config: await skinService.config() });
  } catch (error) {
    return fail(res, error, 'Reading the skins settings');
  }
});
router.put('/admin/config', requireAuth, async (req, res) => {
  try {
    const before = await skinService.config();
    const config = await skinService.setConfig((req.body ?? {}) as Partial<SkinsConfig>);
    // The servers' skins plugin follows the platform's switch.
    if (config.enabled !== before.enabled) {
      void import('../fleet/push/controls').then(({ syncSkinsPluginEverywhere }) =>
        syncSkinsPluginEverywhere()
      );
    } else if (config.enabled && config.catalogUnlocked !== before.catalogUnlocked) {
      void import('../fleet/push/skins').then(({ repushConnectedLoadouts }) =>
        repushConnectedLoadouts()
      );
    }
    return res.json({ success: true, config });
  } catch (error) {
    return fail(res, error, 'Saving the skins settings');
  }
});

/**
 * @openapi
 * /api/skins/admin/catalog:
 *   get:
 *     tags: [Skins]
 *     summary: Search the skin catalogue (admin)
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: all, schema: { type: string, enum: ['1'] }, description: Every paint kit (each Doppler phase) instead of one per name }
 *     responses:
 *       200: { description: Up to 50 matching skins }
 */
router.get('/admin/catalog', requireAuth, async (req, res) => {
  try {
    const skins = searchCatalog(
      await skinService.catalog(),
      req.query.q,
      req.query.all === '1'
    ).slice(0, 50);
    return res.json({ success: true, skins });
  } catch (error) {
    return fail(res, error, 'Searching the catalogue');
  }
});

/**
 * @openapi
 * /api/skins/admin/stats:
 *   get:
 *     tags: [Skins]
 *     summary: How many skins are out there, and the rarest one
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: 'Counts, and the rarest skin with its owner' }
 */
router.get('/admin/stats', requireAuth, async (_req, res) => {
  try {
    return res.json({ success: true, ...(await skinService.adminStats()) });
  } catch (error) {
    return fail(res, error, 'Reading skin stats');
  }
});

/**
 * @openapi
 * /api/skins/admin/players:
 *   get:
 *     tags: [Skins]
 *     summary: Find players to manage their inventory
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string }, description: Part of a name, or a Steam ID }
 *     responses:
 *       200: { description: Up to 30 players with their skin counts }
 */
router.get('/admin/players', requireAuth, async (req, res) => {
  try {
    const players = await skinService.adminFindPlayers(String(req.query.q ?? ''));
    return res.json({
      success: true,
      players: players.map((p) => ({
        steamId: p.id,
        name: p.name,
        avatarUrl: p.avatar_url,
        skins: p.skins,
        best: p.best_name
          ? { weaponName: p.best_weapon, name: p.best_name, rarity: p.best_rarity }
          : null,
      })),
    });
  } catch (error) {
    return fail(res, error, 'Finding players');
  }
});

/**
 * @openapi
 * /api/skins/admin/players/{steamId}/inventory:
 *   get:
 *     tags: [Skins]
 *     summary: A player's whole inventory, for an admin
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: steamId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The player's skins }
 *       404: { description: No such player }
 */
router.get('/admin/players/:steamId/inventory', requireAuth, async (req, res) => {
  try {
    return res.json({
      success: true,
      inventory: await skinService.adminInventory(req.params.steamId),
    });
  } catch (error) {
    return fail(res, error, 'Reading the inventory');
  }
});

/**
 * @openapi
 * /api/skins/admin/players/{steamId}/skins:
 *   post:
 *     tags: [Skins]
 *     summary: Give a player a skin
 *     description: One exact paint kit. Float and pattern are rolled when left out.
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: steamId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [weapon, paintKit]
 *             properties:
 *               weapon: { type: string }
 *               paintKit: { type: integer }
 *               float: { type: number, minimum: 0, maximum: 1 }
 *               pattern: { type: integer, minimum: 0, maximum: 1000 }
 *     responses:
 *       200: { description: The new skin's id }
 *       400: { description: Not in the catalogue }
 *       404: { description: No such player }
 */
router.post('/admin/players/:steamId/skins', requireAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    if (typeof body.weapon !== 'string' || !Number.isInteger(body.paintKit)) {
      return res.status(400).json({ success: false, error: 'weapon and paintKit are required.' });
    }
    const id = await skinService.adminGive(req.params.steamId, {
      weapon: body.weapon,
      paintKit: body.paintKit,
      float: typeof body.float === 'number' ? body.float : null,
      pattern: Number.isInteger(body.pattern) ? body.pattern : null,
    });
    return res.json({ success: true, id });
  } catch (error) {
    return fail(res, error, 'Giving a skin');
  }
});

/**
 * @openapi
 * /api/skins/admin/skins/{id}:
 *   delete:
 *     tags: [Skins]
 *     summary: Take a skin away from its owner
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Removed }
 *       404: { description: No such skin }
 */
router.delete('/admin/skins/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id))
      return res.status(400).json({ success: false, error: 'Bad skin id.' });
    await skinService.adminRemove(id);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Removing a skin');
  }
});

export default router;
