import fs from 'fs';
import path from 'path';
import { PUBLIC_DIR } from '../../../config/publicPaths';

/** The platform's picture route (routes/images.ts): full size and 256 px. */
export const SKIN_IMAGES_BASE = '/api/game/cs2/img/skins';
const SKIN_SMALL_BASE = '/api/game/cs2/img/skins-256';

export interface LocalAssets {
  sha: string;
  base: string;
  complete: boolean;
  maps: Record<string, { small: string; full: string; icon?: string }>;
  skins: Record<string, { small: string; full: string }>;
}

function readJson(publicDir: string, file: string): Partial<LocalAssets> | null {
  return JSON.parse(fs.readFileSync(path.join(publicDir, 'cs2-assets', file), 'utf8'));
}

const cache = new Map<string, LocalAssets | null>();

/** The bundled-image manifest and skins list written at build time; null without a readable manifest. */
export function readLocalAssets(publicDir: string = PUBLIC_DIR): LocalAssets | null {
  if (cache.has(publicDir)) return cache.get(publicDir) ?? null;
  let assets: LocalAssets | null = null;
  try {
    const parsed = readJson(publicDir, 'manifest.json');
    if (parsed && typeof parsed.base === 'string' && parsed.maps) {
      let skins: LocalAssets['skins'] = {};
      try {
        const list = readJson(publicDir, 'skins.json');
        if (list?.sha === parsed.sha && list?.skins) skins = list.skins;
      } catch {
        skins = {};
      }
      assets = {
        sha: parsed.sha ?? '',
        base: parsed.base,
        complete: parsed.complete === true,
        maps: parsed.maps,
        skins,
      };
    }
  } catch {
    assets = null;
  }
  cache.set(publicDir, assets);
  return assets;
}

export function skinImageUrls(
  image: string,
  assets: LocalAssets | null = readLocalAssets()
): { imageUrl: string; imageSmallUrl: string } {
  const entry = assets?.skins[image];
  if (assets && entry) {
    return {
      imageUrl: `${assets.base}/${entry.full}`,
      imageSmallUrl: `${assets.base}/${entry.small}`,
    };
  }
  if (/^https?:\/\//.test(image)) return { imageUrl: image, imageSmallUrl: image };
  return { imageUrl: `${SKIN_IMAGES_BASE}/${image}`, imageSmallUrl: `${SKIN_SMALL_BASE}/${image}` };
}
