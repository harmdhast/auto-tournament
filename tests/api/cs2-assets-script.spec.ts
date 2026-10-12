import { test, expect } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type Job = { kind: string; key: string; src: string; out: string };

// Native import: the script is ESM (import.meta), which the spec transpiler would turn into CJS.
const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
const loadScript = () => nativeImport(pathToFileURL(path.resolve(__dirname, '../../scripts/cs2-assets.mjs')).href);

const maps = {
  maps: [
    { id: 'de_dust2', images: { full: 'de_dust2.webp', thumb: 'de_dust2_thumb.webp', icon: 'de_dust2_icon.svg' } },
    { id: 'ar_baggage', images: { full: 'ar_baggage.webp', thumb: 'ar_baggage_thumb.webp' } },
    { id: 'random', images: { full: 'random.webp' } },
    { id: 'lobby_x', images: { full: 'lobby_x.webp' } },
    { id: 'de.bad', images: { full: 'de.bad.webp' } },
  ],
};
const skins = { skins: [{ image: 'ak47_redline.webp' }] };

test.describe('cs2 assets script', () => {
  test('planAssets lists the map and skin jobs', async () => {
    const { planAssets } = await loadScript();
    const jobs: Job[] = planAssets(maps, skins);
    expect(jobs.map((j) => `${j.kind} ${j.key} ${j.src} ${j.out}`)).toEqual([
      'map-small de_dust2 map_thumbnails/de_dust2.webp maps/de_dust2-small.webp',
      'map-full de_dust2 map_thumbnails/de_dust2.webp maps/de_dust2.webp',
      'map-icon de_dust2 map_thumbnails/de_dust2_icon.svg maps/de_dust2-icon.webp',
      'map-small ar_baggage map_thumbnails/ar_baggage.webp maps/ar_baggage-small.webp',
      'map-full ar_baggage map_thumbnails/ar_baggage.webp maps/ar_baggage.webp',
      'skin-small ak47_redline.webp skin_images/ak47_redline.webp skins/small/ak47_redline.webp',
      'skin-full ak47_redline.webp skin_images/ak47_redline.webp skins/ak47_redline.webp',
    ]);
  });

  test('buildManifest keeps complete entries and omits a missing icon', async () => {
    const { planAssets, buildManifest } = await loadScript();
    const jobs: Job[] = planAssets(maps, skins);
    const manifest = buildManifest('a'.repeat(40), jobs);
    expect(manifest.base).toBe(`/cs2-assets/${'a'.repeat(40)}`);
    expect(manifest.maps.de_dust2).toEqual({
      small: 'maps/de_dust2-small.webp',
      full: 'maps/de_dust2.webp',
      icon: 'maps/de_dust2-icon.webp',
    });
    expect(manifest.maps.ar_baggage).toEqual({ small: 'maps/ar_baggage-small.webp', full: 'maps/ar_baggage.webp' });
    expect(manifest.skins['ak47_redline.webp']).toEqual({
      small: 'skins/small/ak47_redline.webp',
      full: 'skins/ak47_redline.webp',
    });
  });

  test('buildManifest omits a map when its small or full file was not written', async () => {
    const { planAssets, buildManifest } = await loadScript();
    const jobs: Job[] = planAssets(maps, skins);
    const noSmall = jobs.filter((j) => !(j.kind === 'map-small' && j.key === 'de_dust2'));
    expect(Object.keys(buildManifest('b'.repeat(40), noSmall).maps)).toEqual(['ar_baggage']);
    const noFull = jobs.filter((j) => !(j.kind === 'map-full' && j.key === 'ar_baggage'));
    expect(Object.keys(buildManifest('b'.repeat(40), noFull).maps)).toEqual(['de_dust2']);
    const noIcon = jobs.filter((j) => j.kind !== 'map-icon');
    expect(buildManifest('b'.repeat(40), noIcon).maps.de_dust2).not.toHaveProperty('icon');
  });

  test('isCacheHit needs the same sha, a complete manifest and the folder', async () => {
    const { planAssets, buildManifest, isCacheHit } = await loadScript();
    const jobs: Job[] = planAssets(maps, skins);
    const sha = 'c'.repeat(40);
    expect(isCacheHit(buildManifest(sha, jobs, true), sha, true)).toBe(true);
    expect(isCacheHit(buildManifest(sha, jobs, false), sha, true)).toBe(false);
    expect(isCacheHit(buildManifest(sha, jobs, true), 'd'.repeat(40), true)).toBe(false);
    expect(isCacheHit(buildManifest(sha, jobs, true), sha, false)).toBe(false);
    expect(isCacheHit(undefined, sha, true)).toBe(false);
  });

  test('parseMasterSha reads master from a ref advertisement', async () => {
    const { parseMasterSha } = await loadScript();
    const sha = '5b3a1c9e0d7f4a2b8c6e1f0a9d3b7c5e2f4a6d8b';
    const advertisement = [
      '001e# service=git-upload-pack\n0000015b9bb5acf03b4ddeae1d5edc12213d61319a38fd1a HEAD\0multi_ack thin-pack symref=HEAD:refs/heads/master agent=git/github\n',
      '004f9339ea06f95820d8ac13cf29602913c731595151 refs/heads/assets/skins-and-icons\n',
      '0052f35cb6e257c35d368d3624343a4c84b4a804f6dd refs/heads/chore/third-party-notices\n',
      `003d${sha} refs/heads/master\n`,
      '0040aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/master-old\n',
      '0000',
    ].join('');
    expect(parseMasterSha(advertisement)).toBe(sha);
    expect(() => parseMasterSha('0000')).toThrow('master not found');
  });
});
