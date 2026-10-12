/**
 * CS2 map names
 */

import type { CS2MapData } from '../types/veto.types';

export const CS2_MAPS: CS2MapData[] = [
  { name: 'de_ancient', displayName: 'Ancient' },
  { name: 'de_anubis', displayName: 'Anubis' },
  { name: 'de_dust2', displayName: 'Dust II' },
  { name: 'de_inferno', displayName: 'Inferno' },
  { name: 'de_mirage', displayName: 'Mirage' },
  { name: 'de_nuke', displayName: 'Nuke' },
  { name: 'de_vertigo', displayName: 'Vertigo' },
];

export const getMapData = (mapName: string): CS2MapData | undefined => {
  return CS2_MAPS.find((m) => m.name === mapName);
};

/**
 * Title-cased fallback for maps that aren't in CS2_MAPS (workshop maps, maps
 * added to the pool later): "de_train" -> "Train", not "train".
 */
const titleCaseMapName = (mapName: string): string =>
  mapName
    .replace(/^(de|cs|ar|dz)_/, '')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const getMapDisplayName = (mapName: string): string => {
  if (!mapName) return mapName;
  const mapData = getMapData(mapName);
  return mapData?.displayName || titleCaseMapName(mapName) || mapName;
};

