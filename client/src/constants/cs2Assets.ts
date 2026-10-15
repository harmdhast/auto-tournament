/* global AbortController */
/**
 * CS2 map images: the bundled assets listed in `/cs2-assets/manifest.json`,
 * jsDelivr for anything the manifest does not list, and the upload's own
 * small variant for uploaded pictures.
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

/** The platform's picture route (the CS2 module's bundled copies, else csm's). */
const MAP_IMAGE_BASE = '/api/game/cs2/img';
const UPLOAD_PREFIX = '/map-images/';
const LOAD_TIMEOUT_MS = 1500;

const isManifest = (value: unknown): value is Cs2AssetsManifest => {
  const m = value as Cs2AssetsManifest | null;
  return !!m && typeof m.base === 'string' && !!m.maps && typeof m.maps === 'object';
};

/** Reads the manifest once; never throws, a missing one leaves jsDelivr in use. */
export const loadCs2Assets = async (): Promise<void> => {
  if (globalThis.__AT_CS2_ASSETS__) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  try {
    const res = await fetch('/cs2-assets/manifest.json', { signal: controller.signal });
    if (!res.ok) return;
    const json: unknown = await res.json();
    if (isManifest(json)) globalThis.__AT_CS2_ASSETS__ = json;
  } catch {
    // jsDelivr keeps serving
  } finally {
    clearTimeout(timer);
  }
};

export const isUploadedMapImage = (url?: string | null): boolean =>
  !!url && url.startsWith(UPLOAD_PREFIX);

export const isCatalogMapImage = (url?: string | null): boolean =>
  !!url &&
  ((url.includes('cs2-server-manager') && url.includes('map_thumbnails')) ||
    url.startsWith(`${MAP_IMAGE_BASE}/`));

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
    ? `${MAP_IMAGE_BASE}/maps-480/${id}.webp`
    : size === 'icon'
      ? `${MAP_IMAGE_BASE}/map-icons/${id}_icon.svg`
      : `${MAP_IMAGE_BASE}/maps-1280/${id}.webp`;

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
