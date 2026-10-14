import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { test, expect } from '@playwright/test';

/**
 * The host channel schemas are copied between the CS2 Server Manager
 * (`protocol/host-v1`) and the platform
 * (`api/src/integrations/cs2/fleet/protocol/host/v1`), FLEET.md D18.
 *
 * Opt-in: `CSM_DIR` is a local checkout of Auto-Tournament/cs2-server-manager,
 * `CSM_REF` (optional) a git ref in it to compare instead of the working tree.
 * Every schema file that exists on both sides must be the same JSON. Files
 * only the manager has are listed but do not fail.
 *
 * @tag api
 */

const PLATFORM_DIR = path.resolve(
  __dirname,
  '../../api/src/integrations/cs2/fleet/protocol/host/v1'
);
const CSM_PROTOCOL = 'protocol/host-v1';

function walkJson(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json'))
        out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

const git = (dir: string, args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

function csmSource(
  dir: string,
  ref: string | undefined
): { files: string[]; read(rel: string): string } {
  if (ref) {
    const files = git(dir, ['ls-tree', '-r', '--name-only', ref, '--', `${CSM_PROTOCOL}/`])
      .split('\n')
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(CSM_PROTOCOL.length + 1))
      .sort();
    return { files, read: (rel) => git(dir, ['show', `${ref}:${CSM_PROTOCOL}/${rel}`]) };
  }
  const root = path.resolve(dir, CSM_PROTOCOL);
  return { files: walkJson(root), read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8') };
}

test.describe('Host protocol: in sync with the CS2 Server Manager', () => {
  test('every schema both sides have is the same JSON', async () => {
    const dir = process.env.CSM_DIR;
    test.skip(!dir, 'set CSM_DIR to a cs2-server-manager checkout (CSM_REF for a git ref)');
    if (!dir) return;

    const source = csmSource(dir, process.env.CSM_REF || undefined);
    const ours = new Set(walkJson(PLATFORM_DIR));
    const shared = source.files.filter((f) => ours.has(f));
    expect(shared.length, 'no schema files in common: wrong path?').toBeGreaterThanOrEqual(20);

    const drift: string[] = [];
    for (const rel of shared) {
      const theirs = JSON.parse(source.read(rel)) as unknown;
      const mine = JSON.parse(fs.readFileSync(path.join(PLATFORM_DIR, rel), 'utf8')) as unknown;
      try {
        expect(mine).toEqual(theirs);
      } catch {
        drift.push(rel);
      }
    }

    const onlyCsm = source.files.filter((f) => !ours.has(f));
    if (onlyCsm.length) {
      test
        .info()
        .annotations.push({ type: 'csm only (not adopted)', description: onlyCsm.join(', ') });
    }
    const onlyPlatform = [...ours].filter((f) => !source.files.includes(f));
    if (onlyPlatform.length) {
      test.info().annotations.push({ type: 'platform only', description: onlyPlatform.join(', ') });
    }
    expect(
      drift,
      `copy these between cs2-server-manager ${CSM_PROTOCOL} and the platform (or change both sides)`
    ).toEqual([]);
  });
});
