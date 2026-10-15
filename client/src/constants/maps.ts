/**
 * CS2 map names
 */

import type { CS2MapData } from '../types/veto.types';

// Map pictures, served by the platform (the CS2 module bundles csm's compressed copies):
// 1280 px for large hero/background displays, 480 px for smaller cards/lists.
const MAP_IMAGE_BASE = '/api/game/cs2/img';

const getFullImageUrl = (mapName: string): string => `${MAP_IMAGE_BASE}/maps-1280/${mapName}.webp`;

/** The map's full-size picture, for heroes and banners. */
export const getMapImageUrl = (mapName: string): string => getFullImageUrl(mapName);

/** The map's flat icon (`de_mirage_icon.svg`), for small marks and pills. */
export const getMapIconUrl = (mapName: string): string =>
  `${MAP_IMAGE_BASE}/map-icons/${mapName}_icon.svg`;

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
