import { useCallback, useEffect, useState } from 'react';
import { api, useAuth } from '../../../module-sdk';
import type { AccountMenuItem } from '../../types';
import { skinPaths } from './paths';

export type Rarity =
  'common' | 'uncommon' | 'rare' | 'mythical' | 'legendary' | 'ancient' | 'immortal';

export interface OwnedSkin {
  id: number;
  weapon: string;
  weaponName: string;
  name: string;
  rarity: Rarity;
  imageUrl: string;
  imageSmallUrl: string;
  slot: string;
  float: number;
  pattern: number;
  source: 'matchmaking' | 'tournament' | 'admin' | 'catalog';
  sourceLabel: string | null;
  sourceRef: string | null;
  place: number | null;
  createdAt: number;
  seen: boolean;
  equipped: boolean;
}

/** A skin of the catalogue, equippable with any float and pattern while the catalog is unlocked. */
export interface CatalogSkin {
  weapon: string;
  weaponName: string;
  paintKit: number;
  name: string;
  rarity: Rarity;
  variant: string | null;
  slot: string;
  imageUrl: string;
  imageSmallUrl: string;
}

export interface PickInput {
  weapon: string;
  paintKit: number;
  float: number;
  pattern: number;
}

export interface ShowcaseItem {
  skinId: number;
  big: boolean;
}

/** The account menu's Inventory link, while skins are on (`accountMenuItems`). */
export async function skinsAccountMenuItems(): Promise<AccountMenuItem[]> {
  const status = await api.get<{ enabled: boolean }>('/api/skins/status');
  return status.enabled
    ? [{ key: 'inventory', path: skinPaths.inventory, labelKey: 'skins.inventory' }]
    : [];
}

/** Whether virtual skins are on, and whether players may equip any catalogue skin. Null while unknown. */
export function useSkinsStatus(): { enabled: boolean; catalogUnlocked: boolean } | null {
  const [status, setStatus] = useState<{ enabled: boolean; catalogUnlocked: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ enabled: boolean; catalogUnlocked?: boolean }>('/api/skins/status')
      .then(
        (r) =>
          !cancelled &&
          setStatus({ enabled: Boolean(r.enabled), catalogUnlocked: Boolean(r.catalogUnlocked) })
      )
      .catch(() => !cancelled && setStatus({ enabled: false, catalogUnlocked: false }));
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

/** A weapon slot of the catalogue. */
export interface CatalogWeapon {
  weapon: string;
  weaponName: string;
  slot: string;
  category: 'knives' | 'gloves' | 'pistols' | 'smgs' | 'rifles' | 'heavy';
}

/** Every weapon slot of the catalogue, read once while `enabled`. Empty otherwise. */
export function useCatalogWeapons(enabled: boolean): CatalogWeapon[] {
  const [weapons, setWeapons] = useState<CatalogWeapon[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get<{ weapons?: CatalogWeapon[] }>('/api/skins/catalog/weapons')
      .then((r) => !cancelled && setWeapons(r.weapons ?? []))
      .catch(() => !cancelled && setWeapons([]));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? weapons : [];
}

/** Whether virtual skins are on. Null while unknown. */
export function useSkinsEnabled(): boolean | null {
  return useSkinsStatus()?.enabled ?? null;
}

/** Every skins view reloads after a change made in any of them (the reveal, the grid, the profile). */
const CHANGED = 'skins:changed';
/** Every open skins view reads again (after a change here, or a push from the platform). */
export function announceChange(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** The signed-in player's inventory, showcase and new skins, with the actions on them. */
export function useMySkins() {
  const { playerUid } = useAuth();
  const [inventory, setInventory] = useState<OwnedSkin[]>([]);
  const [picks, setPicks] = useState<OwnedSkin[]>([]);
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([]);
  const [unseen, setUnseen] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);

  const reload = useCallback(async () => {
    if (!playerUid) {
      setLoading(false);
      setAvailable(false);
      return;
    }
    try {
      const data = await api.get<{
        inventory: OwnedSkin[];
        picks?: OwnedSkin[];
        showcase: ShowcaseItem[];
        unseen: number[];
      }>('/api/skins/me');
      setInventory(data.inventory ?? []);
      setPicks(data.picks ?? []);
      setShowcase(data.showcase ?? []);
      setUnseen(data.unseen ?? []);
      setAvailable(true);
    } catch {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [playerUid]);

  useEffect(() => {
    void reload();
    const onChange = () => void reload();
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [reload]);

  /**
   * Equips at once (the grid shows it before the server answers), or, for
   * the skin already equipped, empties its slot: the game's default is back.
   */
  const equip = useCallback(async (skin: OwnedSkin) => {
    const off = skin.equipped;
    let before: OwnedSkin[] = [];
    setInventory((list) => {
      before = list;
      return list.map((s) =>
        s.slot === skin.slot ? { ...s, equipped: !off && s.id === skin.id } : s
      );
    });
    try {
      if (off) await api.delete(`/api/skins/me/equip/${encodeURIComponent(skin.slot)}`);
      else await api.post('/api/skins/me/equip', { skinId: skin.id });
    } catch (error) {
      // A refused equip used to vanish (the grid showed it equipped, the
      // server never stored it): put the grid back and tell the caller.
      setInventory(before);
      throw error;
    } finally {
      announceChange();
    }
  }, []);

  /** Empties a slot (a pick is deleted with it): the game's default is back. */
  const unequip = useCallback(async (slot: string) => {
    try {
      await api.delete(`/api/skins/me/equip/${encodeURIComponent(slot)}`);
    } finally {
      announceChange();
    }
  }, []);

  const markSeen = useCallback(async (ids: number[]) => {
    setUnseen((list) => list.filter((id) => !ids.includes(id)));
    await api.post('/api/skins/me/seen', { ids }).catch(() => undefined);
    announceChange();
  }, []);

  const saveShowcase = useCallback(async (items: ShowcaseItem[]) => {
    setShowcase(items);
    await api.put('/api/skins/me/showcase', { items });
    announceChange();
  }, []);

  /** Equips a catalogue skin with the float and pattern the player chose. */
  const pick = useCallback(async (input: PickInput) => {
    await api.put('/api/skins/me/picks', input);
    announceChange();
  }, []);

  return {
    inventory,
    picks,
    showcase,
    unseen,
    loading,
    available,
    reload,
    equip,
    unequip,
    pick,
    markSeen,
    saveShowcase,
  };
}

/** The slots a loadout shows: knife and gloves always, then each weapon with a skin owned or picked. */
export function loadoutSlots(inventory: OwnedSkin[], picks: OwnedSkin[] = []): string[] {
  const weapons = [
    ...new Set(
      [...inventory, ...picks].map((s) => s.slot).filter((s) => s !== 'knife' && s !== 'gloves')
    ),
  ];
  return ['knife', 'gloves', ...weapons];
}

/** "Factory New" … "Battle-Scarred" for a float, as CS2 names wear. */
export function wearKey(float: number): 'fn' | 'mw' | 'ft' | 'ww' | 'bs' {
  if (float < 0.07) return 'fn';
  if (float < 0.15) return 'mw';
  if (float < 0.38) return 'ft';
  if (float < 0.45) return 'ww';
  return 'bs';
}
