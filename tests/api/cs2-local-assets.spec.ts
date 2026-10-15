import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readLocalAssets, skinImageUrls } from '../../api/src/integrations/cs2/assets/localAssets';

const REMOTE = '/api/game/cs2/img/skins';
const REMOTE_SMALL = '/api/game/cs2/img/skins-256';

function tempPublic(manifest: string, skins?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2-assets-'));
  fs.mkdirSync(path.join(dir, 'cs2-assets'));
  fs.writeFileSync(path.join(dir, 'cs2-assets', 'manifest.json'), manifest);
  if (skins !== undefined) fs.writeFileSync(path.join(dir, 'cs2-assets', 'skins.json'), skins);
  return dir;
}

const manifest = JSON.stringify({
  sha: 'abc',
  base: '/cs2-assets/abc',
  complete: true,
  maps: {},
});

const skinsList = JSON.stringify({
  sha: 'abc',
  base: '/cs2-assets/abc',
  skins: { 'ak47_x.png': { small: 'skins/small/ak47_x.webp', full: 'skins/ak47_x.png' } },
});

test.describe('cs2 local assets', () => {
  test('listed skin resolves to bundled full and small', () => {
    const assets = readLocalAssets(tempPublic(manifest, skinsList));
    expect(skinImageUrls('ak47_x.png', assets)).toEqual({
      imageUrl: '/cs2-assets/abc/skins/ak47_x.png',
      imageSmallUrl: '/cs2-assets/abc/skins/small/ak47_x.webp',
    });
  });

  test("unlisted skin falls back to the platform's picture route", () => {
    const assets = readLocalAssets(tempPublic(manifest, skinsList));
    expect(skinImageUrls('other.png', assets)).toEqual({
      imageUrl: `${REMOTE}/other.png`,
      imageSmallUrl: `${REMOTE_SMALL}/other.png`,
    });
  });

  test("null assets fall back to the platform's picture route", () => {
    expect(skinImageUrls('ak47_x.png', null).imageUrl).toBe(`${REMOTE}/ak47_x.png`);
  });

  test("a missing skins list leaves skins on the platform's picture route", () => {
    const assets = readLocalAssets(tempPublic(manifest));
    expect(assets?.skins).toEqual({});
    expect(skinImageUrls('ak47_x.png', assets).imageUrl).toBe(`${REMOTE}/ak47_x.png`);
  });

  test('invalid or missing manifest reads as null', () => {
    expect(readLocalAssets(tempPublic('{not json'))).toBeNull();
    expect(readLocalAssets(fs.mkdtempSync(path.join(os.tmpdir(), 'cs2-none-')))).toBeNull();
  });
});
