import { test, expect } from '@playwright/test';
import {
  mapImageUrl,
  mapImageFallback,
  isUploadedMapImage,
  isCustomMapImage,
  isCatalogMapImage,
} from '../../client/src/constants/cs2Assets';
import {
  mapImageUrl as moduleMapImageUrl,
  mapImageFallback as moduleMapImageFallback,
} from '../../client/src/integrations/cs2/maps/cs2Assets';

/**
 * Map image URLs: bundled assets when the manifest lists the map, jsDelivr
 * otherwise, uploads with their own small variant.
 *
 * @tag ui
 */

const CDN = 'https://cdn.jsdelivr.net/gh/Auto-Tournament/cs2-server-manager@master/map_thumbnails';
const BASE = '/cs2-assets/abc123';
const g = globalThis as { __AT_CS2_ASSETS__?: unknown };

const manifest = {
  sha: 'abc123',
  base: BASE,
  complete: true,
  maps: {
    de_mirage: {
      small: 'maps/de_mirage-small.webp',
      full: 'maps/de_mirage.webp',
      icon: 'maps/de_mirage-icon.webp',
    },
    de_noicon: { small: 'maps/de_noicon-small.webp', full: 'maps/de_noicon.webp' },
  },
  skins: {},
};

test.describe('map image helper', () => {
  test.afterEach(() => {
    delete g.__AT_CS2_ASSETS__;
  });

  test('a listed map is served from the bundled assets with a jsDelivr fallback', () => {
    g.__AT_CS2_ASSETS__ = manifest;
    expect(mapImageUrl('de_mirage', 'small')).toBe(`${BASE}/maps/de_mirage-small.webp`);
    expect(mapImageUrl('de_mirage', 'full')).toBe(`${BASE}/maps/de_mirage.webp`);
    expect(mapImageUrl('de_mirage', 'icon')).toBe(`${BASE}/maps/de_mirage-icon.webp`);
    expect(mapImageFallback('de_mirage', 'small')).toBe(`${CDN}/de_mirage_thumb.webp`);
    expect(mapImageFallback('de_mirage', 'full')).toBe(`${CDN}/de_mirage.webp`);
    expect(mapImageFallback('de_mirage', 'icon')).toBe(`${CDN}/de_mirage_icon.svg`);
  });

  test('an unlisted map uses jsDelivr and has no fallback', () => {
    g.__AT_CS2_ASSETS__ = manifest;
    expect(mapImageUrl('de_train', 'small')).toBe(`${CDN}/de_train_thumb.webp`);
    expect(mapImageUrl('de_train', 'full')).toBe(`${CDN}/de_train.webp`);
    expect(mapImageUrl('de_train', 'icon')).toBe(`${CDN}/de_train_icon.svg`);
    expect(mapImageFallback('de_train', 'small')).toBeUndefined();
  });

  test('a listed map without an icon uses the jsDelivr icon', () => {
    g.__AT_CS2_ASSETS__ = manifest;
    expect(mapImageUrl('de_noicon', 'icon')).toBe(`${CDN}/de_noicon_icon.svg`);
  });

  test('an upload has a small variant that falls back to the upload', () => {
    g.__AT_CS2_ASSETS__ = manifest;
    const up = '/map-images/de_x.webp?v=5';
    expect(mapImageUrl('de_x', 'small', up)).toBe('/map-images/de_x-small.webp?v=5');
    expect(mapImageFallback('de_x', 'small', up)).toBe(up);
    expect(mapImageUrl('de_x', 'full', up)).toBe(up);
    expect(mapImageFallback('de_x', 'full', up)).toBeUndefined();
    expect(mapImageUrl('de_x', 'small', '/map-images/de_x.webp')).toBe('/map-images/de_x-small.webp');
  });

  test('a catalogue url is not an upload', () => {
    g.__AT_CS2_ASSETS__ = manifest;
    const cat = `${CDN}/de_mirage.webp`;
    expect(isUploadedMapImage(cat)).toBe(false);
    expect(isUploadedMapImage(undefined)).toBe(false);
    expect(isUploadedMapImage('/map-images/a.webp')).toBe(true);
    expect(mapImageUrl('de_mirage', 'small', cat)).toBe(`${BASE}/maps/de_mirage-small.webp`);
  });

  test('an external picture is used as-is for small and full, with no fallback', () => {
    g.__AT_CS2_ASSETS__ = manifest;
    const ext = 'https://images.steamusercontent.com/ugc/123/ABC/';
    expect(isCustomMapImage(ext)).toBe(true);
    expect(isCatalogMapImage(`${CDN}/de_mirage.webp`)).toBe(true);
    expect(isCustomMapImage(`${CDN}/de_mirage.webp`)).toBe(false);
    expect(mapImageUrl('3070284539', 'small', ext)).toBe(ext);
    expect(mapImageUrl('3070284539', 'full', ext)).toBe(ext);
    expect(mapImageFallback('3070284539', 'small', ext)).toBeUndefined();
    expect(mapImageFallback('3070284539', 'full', ext)).toBeUndefined();
    expect(mapImageUrl('de_mirage', 'icon', ext)).toBe(`${BASE}/maps/de_mirage-icon.webp`);
    expect(moduleMapImageUrl('3070284539', 'small', ext)).toBe(ext);
  });

  test('without a manifest everything is jsDelivr', () => {
    expect(mapImageUrl('de_mirage', 'small')).toBe(`${CDN}/de_mirage_thumb.webp`);
    expect(mapImageUrl('de_mirage', 'full')).toBe(`${CDN}/de_mirage.webp`);
    expect(mapImageFallback('de_mirage', 'small')).toBeUndefined();
  });

  test('the module copy agrees with core', () => {
    g.__AT_CS2_ASSETS__ = manifest;
    for (const size of ['small', 'full', 'icon'] as const) {
      for (const id of ['de_mirage', 'de_train']) {
        expect(moduleMapImageUrl(id, size)).toBe(mapImageUrl(id, size));
        expect(moduleMapImageFallback(id, size)).toBe(mapImageFallback(id, size));
      }
    }
    const up = '/map-images/de_x.webp?v=5';
    expect(moduleMapImageUrl('de_x', 'small', up)).toBe(mapImageUrl('de_x', 'small', up));
    expect(moduleMapImageFallback('de_x', 'small', up)).toBe(up);
  });
});
