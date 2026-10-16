import { test, expect } from '@playwright/test';
import { db } from '../../api/src/config/database';
import { recoverActiveMatches } from '../../api/src/services/matchRecoveryService';

/**
 * A match left `ready` with a server_id by a crash mid-allocation is released
 * by the startup recovery (the first run in a process), so it can be allocated
 * again. Later runs (the admin route) leave it alone: an allocation may be in
 * flight.
 *
 * @tag api
 */
const stamp = Date.now();
const SERVER = `ready-recovery-server-${stamp}`;
const FIRST = `ready-recovery-a-${stamp}`;
const LATER = `ready-recovery-b-${stamp}`;

const serverOf = async (slug: string) =>
  (
    await db.queryOneAsync<{ server_id: string | null }>(
      'SELECT server_id FROM matches WHERE slug = ?',
      [slug]
    )
  )?.server_id ?? null;

const addReadyMatch = (slug: string) =>
  db.insertAsync('matches', {
    slug,
    tournament_id: null,
    round: 0,
    match_number: 0,
    config: '{}',
    status: 'ready',
    server_id: SERVER,
  });

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await db.insertAsync('cs2_servers', {
    id: SERVER,
    name: SERVER,
    host: '127.0.0.1',
    port: 27015,
    password: 'x',
  });
});

test.afterAll(async () => {
  await db.runAsync('DELETE FROM matches WHERE slug IN (?, ?)', [FIRST, LATER]);
  await db.runAsync('DELETE FROM cs2_servers WHERE id = ?', [SERVER]);
});

test('startup recovery releases a ready match that holds a server', { tag: ['@api'] }, async () => {
  await addReadyMatch(FIRST);
  await recoverActiveMatches();
  expect(await serverOf(FIRST)).toBeNull();
});

test('a later recovery run leaves a ready match alone', { tag: ['@api'] }, async () => {
  await addReadyMatch(LATER);
  await recoverActiveMatches();
  expect(await serverOf(LATER)).toBe(SERVER);
});
