/**
 * CS2 map images. This module's copy of `constants/cs2Assets.ts`: a module
 * built on its own cannot reach core's. It reads the manifest core loads into
 * `globalThis` before the first render and never fetches.
 */

export type MapImageSize = 'small' | 'full' | 'icon';

interface Cs2AssetsManifest {
  sha: string;
  base: string;
  complete: boolean;
  maps: Record<string, { small: string; full: string; icon?: string }>;
}

declare global {
  var __AT_CS2_ASSETS__: Cs2AssetsManifest | undefined;
}

const MAP_IMAGE_BASE =
  'https://cdn.jsdelivr.net/gh/Auto-Tournament/cs2-server-manager@master/map_thumbnails';
const UPLOAD_PREFIX = '/map-images/';

export const isUploadedMapImage = (url?: string | null): boolean =>
  !!url && url.startsWith(UPLOAD_PREFIX);

export const isCatalogMapImage = (url?: string | null): boolean =>
  !!url && url.includes('cs2-server-manager') && url.includes('map_thumbnails');

/** A picture of the map's own: an upload or any other URL that is not the catalogue's. */
export const isCustomMapImage = (url?: string | null): url is string =>
  !!url && !isCatalogMapImage(url);

const uploadedSmall = (url: string): string => {
  const [path, query = ''] = url.split(/\?(.*)/s, 2);
  const small = /\.[a-z0-9]+$/i.test(path)
    ? path.replace(/(\.[a-z0-9]+)$/i, '-small$1')
    : `${path}-small`;
  return query ? `${small}?${query}` : small;
};

/** The catalogue's own picture, what an unlisted map shows and a reset goes back to. */
export const mapCatalogUrl = (id: string, size: MapImageSize): string =>
  size === 'small'
    ? `${MAP_IMAGE_BASE}/${id}_thumb.webp`
    : size === 'icon'
      ? `${MAP_IMAGE_BASE}/${id}_icon.svg`
      : `${MAP_IMAGE_BASE}/${id}.webp`;

const bundledUrl = (id: string, size: MapImageSize): string | undefined => {
  const manifest = globalThis.__AT_CS2_ASSETS__;
  const path = manifest?.maps[id]?.[size];
  return manifest && path ? `${manifest.base}/${path}` : undefined;
};

export const mapImageUrl = (id: string, size: MapImageSize, customUrl?: string | null): string => {
  if (isCustomMapImage(customUrl) && size !== 'icon') {
    return size === 'small' && isUploadedMapImage(customUrl) ? uploadedSmall(customUrl) : customUrl;
  }
  return bundledUrl(id, size) ?? mapCatalogUrl(id, size);
};

/** What to try when the first URL fails to load. */
export const mapImageFallback = (
  id: string,
  size: MapImageSize,
  customUrl?: string | null
): string | undefined => {
  if (isCustomMapImage(customUrl) && size !== 'icon') {
    return size === 'small' && isUploadedMapImage(customUrl) ? customUrl : undefined;
  }
  return bundledUrl(id, size) ? mapCatalogUrl(id, size) : undefined;
};
