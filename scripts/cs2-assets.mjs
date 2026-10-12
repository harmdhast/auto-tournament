#!/usr/bin/env node
/* global fetch, AbortSignal, Buffer */
/**
 * Download the CS2 map and skin images from the cs2-server-manager repo and
 * resize them into client/public/cs2-assets/<sha>/, so the app serves them
 * itself instead of loading them from a CDN.
 *
 * Runs before `vite build`. Output is cached by the repo's master commit sha:
 * when the folder and manifest for that sha exist, nothing is fetched. Any
 * top-level failure (offline, rate limit, sharp missing) warns and exits 0,
 * leaving previous output in place; the app falls back to the CDN.
 *
 * The commit is read from the git smart-HTTP ref advertisement, which has no
 * API quota and needs no token.
 *
 * Env: CS2_ASSETS_SOURCE (JSON {"refs": "<info/refs url>", "raw": "<raw base
 * url>"} replacing the GitHub URLs).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'client', 'public', 'cs2-assets');
const REPO = 'Auto-Tournament/cs2-server-manager';
const REFS_URL = `https://github.com/${REPO}.git/info/refs?service=git-upload-pack`;
const CONCURRENCY = 16;
const TIMEOUT_MS = 20_000;

/** Same rule as isPlayableMapId in api/src/integrations/cs2/maps/mapCatalog.ts. */
function isPlayableMapId(id) {
  if (!/^[a-z0-9_]+$/.test(id)) return false;
  if (id === 'random' || id.startsWith('lobby_') || id.startsWith('default')) return false;
  return true;
}

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The commit sha of refs/heads/master in a git-upload-pack ref advertisement (pkt-line text). */
export function parseMasterSha(advertisement) {
  for (const line of String(advertisement).split('\n')) {
    const match = /([0-9a-f]{40}) refs\/heads\/master(?:\0.*)?$/.exec(line);
    if (match) return match[1];
  }
  throw new Error('master not found in the ref advertisement');
}

/** The files to produce for a maps.json and a skins.json; `out` is relative to `<sha>/`. */
export function planAssets(mapsJson, skinsJson) {
  const jobs = [];
  const seen = new Set();
  for (const entry of Array.isArray(mapsJson?.maps) ? mapsJson.maps : []) {
    const id = text(entry?.id);
    if (!id || seen.has(id) || !isPlayableMapId(id)) continue;
    seen.add(id);
    const images = entry.images ?? {};
    const full = text(images.full) ?? `${id}.webp`;
    jobs.push({ kind: 'map-small', key: id, src: `map_thumbnails/${full}`, out: `maps/${id}-small.webp` });
    jobs.push({ kind: 'map-full', key: id, src: `map_thumbnails/${full}`, out: `maps/${id}.webp` });
    const icon = text(images.icon);
    if (icon) jobs.push({ kind: 'map-icon', key: id, src: `map_thumbnails/${icon}`, out: `maps/${id}-icon.webp` });
  }
  const skinSeen = new Set();
  for (const entry of Array.isArray(skinsJson?.skins) ? skinsJson.skins : []) {
    const image = text(entry?.image);
    if (!image || skinSeen.has(image) || image.includes('..') || image.startsWith('/')) continue;
    skinSeen.add(image);
    jobs.push({
      kind: 'skin-small',
      key: image,
      src: `skin_images/${image}`,
      out: `skins/small/${image.replace(/\.[^./]+$/, '')}.webp`,
    });
    jobs.push({ kind: 'skin-full', key: image, src: `skin_images/${image}`, out: `skins/${image}` });
  }
  return jobs;
}

/** The boot manifest (maps only) for the jobs that were written; an entry needs all its required files. */
export function buildManifest(sha, written, complete = true) {
  const by = (kind) => new Map(written.filter((j) => j.kind === kind).map((j) => [j.key, j.out]));
  const small = by('map-small');
  const full = by('map-full');
  const icon = by('map-icon');
  const maps = {};
  for (const [id, smallOut] of small) {
    const fullOut = full.get(id);
    if (!fullOut) continue;
    maps[id] = { small: smallOut, full: fullOut, ...(icon.has(id) ? { icon: icon.get(id) } : {}) };
  }
  return { sha, base: `/cs2-assets/${sha}`, complete, maps };
}

/** The skin images that were written, kept apart so the client's boot manifest stays small. */
export function buildSkinsManifest(sha, written) {
  const by = (kind) => new Map(written.filter((j) => j.kind === kind).map((j) => [j.key, j.out]));
  const skinFull = by('skin-full');
  const skins = {};
  for (const [image, smallOut] of by('skin-small')) {
    const fullOut = skinFull.get(image);
    if (fullOut) skins[image] = { small: smallOut, full: fullOut };
  }
  return { sha, base: `/cs2-assets/${sha}`, skins };
}

/** A previous run for `sha` is reusable only when it wrote every file. */
export function isCacheHit(manifest, sha, folderExists) {
  return manifest?.sha === sha && manifest.complete === true && folderExists;
}

async function fetchBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function convert(sharp, job, input) {
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  switch (job.kind) {
    case 'map-small':
      return sharp(input).resize(640, 360, { fit: 'cover', kernel: 'lanczos3' }).webp({ quality: 80 }).toBuffer();
    case 'map-full':
      return sharp(input).resize(1920, 1080, { fit: 'cover', kernel: 'lanczos3' }).webp({ quality: 75 }).toBuffer();
    case 'map-icon':
      return sharp(input, { density: 300 })
        .resize(64, 64, { fit: 'contain', background: clear })
        .webp({ quality: 90 })
        .toBuffer();
    case 'skin-small':
      return sharp(input)
        .resize(128, 96, { fit: 'contain', background: clear, kernel: 'lanczos3' })
        .webp({ quality: 85 })
        .toBuffer();
    default:
      return input;
  }
}

async function runJobs(jobs, task) {
  const written = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await task(job);
        written.push(job);
      } catch (err) {
        console.warn(`cs2-assets: skipped ${job.out}: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return written;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const source = process.env.CS2_ASSETS_SOURCE ? JSON.parse(process.env.CS2_ASSETS_SOURCE) : {};
  const refsUrl = source.refs ?? REFS_URL;
  const rawBase = source.raw ?? `https://raw.githubusercontent.com/${REPO}`;
  const { default: sharp } = await import('sharp');
  const sha = parseMasterSha((await fetchBuffer(refsUrl)).toString());

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  const shaDir = path.join(OUT_DIR, sha);
  try {
    const current = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (isCacheHit(current, sha, await exists(shaDir))) {
      console.log(`cs2-assets: ${sha.slice(0, 7)} is up to date`);
      return;
    }
  } catch {
    // no usable manifest yet
  }

  const raw = (file) => `${rawBase}/${sha}/${file}`;
  const mapsJson = JSON.parse((await fetchBuffer(raw('map_thumbnails/maps.json'))).toString());
  const skinsJson = JSON.parse((await fetchBuffer(raw('skin_images/skins.json'))).toString());
  const jobs = planAssets(mapsJson, skinsJson);

  const sources = new Map();
  const written = await runJobs(jobs, async (job) => {
    const target = path.join(shaDir, job.out);
    if (await exists(target)) return;
    // Small and full share one download.
    let download = sources.get(job.src);
    if (!download) {
      download = fetchBuffer(raw(job.src));
      sources.set(job.src, download);
      const forget = () => setTimeout(() => sources.delete(job.src), 0);
      download.then(forget, forget);
    }
    const out = await convert(sharp, job, await download);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, out);
  });

  if (written.length === 0) throw new Error('no image could be downloaded');
  await fs.mkdir(OUT_DIR, { recursive: true });
  const manifest = buildManifest(sha, written, written.length === jobs.length);
  const skinsManifest = buildSkinsManifest(sha, written);
  await fs.writeFile(path.join(OUT_DIR, 'skins.json'), JSON.stringify(skinsManifest));
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  for (const entry of await fs.readdir(OUT_DIR)) {
    if (entry !== sha && entry !== 'manifest.json' && entry !== 'skins.json') await fs.rm(path.join(OUT_DIR, entry), { recursive: true, force: true });
  }
  console.log(
    `cs2-assets: ${sha.slice(0, 7)}: ${Object.keys(manifest.maps).length} maps, ${Object.keys(skinsManifest.skins).length} skins`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.warn(`cs2-assets: ${err.message}; keeping existing images, the app falls back to the CDN`);
  });
}
