import fs from 'fs';
import path from 'path';
import { PUBLIC_DIR } from '../../../config/publicPaths';

export const SKIN_IMAGES_BASE =
  'https://cdn.jsdelivr.net/gh/Auto-Tournament/cs2-server-manager@master/skin_images';

export interface LocalAssets {
  sha: string;
  base: string;
  complete: boolean;
  maps: Record<string, { small: string; full: string; icon?: string }>;
  skins: Record<string, { small: string; full: string }>;
}

const cache = new Map<string, LocalAssets | null>();

/** The bundled-image manifest written at build time; null when absent or unreadable. */
export function readLocalAssets(publicDir: string = PUBLIC_DIR): LocalAssets | null {
  if (cache.has(publicDir)) return cache.get(publicDir) ?? null;
  let assets: LocalAssets | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(publicDir, 'cs2-assets', 'manifest.json'), 'utf8'));
    if (parsed && typeof parsed.base === 'string' && parsed.maps && parsed.skins) assets = parsed;
  } catch {
    assets = null;
  }
  cache.set(publicDir, assets);
  return assets;
}

export function skinImageUrls(
  image: string,
  assets: LocalAssets | null = readLocalAssets(),
): { imageUrl: string; imageSmallUrl: string } {
  const entry = assets?.skins[image];
  if (assets && entry) {
    return { imageUrl: `${assets.base}/${entry.full}`, imageSmallUrl: `${assets.base}/${entry.small}` };
  }
  const remote = `${SKIN_IMAGES_BASE}/${image}`;
  return { imageUrl: remote, imageSmallUrl: remote };
}
