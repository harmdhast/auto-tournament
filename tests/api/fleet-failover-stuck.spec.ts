import { execFileSync } from 'child_process';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import {
  FakeReadyUp,
  acceptAssign,
  createMatch,
  link,
  matchRow,
  releaseFleet,
} from '../helpers/fleetFake';

/**
 * A failover is never left in `moving` (fleet/failover.ts):
 * - a move that throws after the claim puts the match back on its old server
 *   and the failover is open again, so the next move works;
 * - a `moving` row nobody is carrying out (a restart or a crash inside the
 *   move) is opened again by the next detection pass.
 *
 * @tag api
 * @tag fleet
 */
const DB = process.env.DB_NAME ?? 'auto_tournament';

const psql = (sql: string): string =>
  execFileSync(
    'podman',
    ['exec', 'auto-tournament-postgres', 'psql', '-U', 'postgres', '-d', DB, '-At', '-c', sql],
    { encoding: 'utf8' }
  ).trim();

async function setFailover(request: APIRequestContext, data: { auto?: boolean; csm?: boolean }) {
  const res = await request.put('/api/fleet/failover/settings', { headers: getAuthHeader(), data });
  expect(res.ok(), await res.text()).toBe(true);
}

async function proposalOf(request: APIRequestContext, slug: string) {
  const res = await request.get(`/api/game/cs2/matches/${slug}/failover`, {
    headers: getAuthHeader(),
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).proposal as {
    id: string;
    status: string;
    lastError?: string | null;
  } | null;
}

async function scan(request: APIRequestContext) {
  const res = await request.post('/api/test/fleet/failover/scan', {
    headers: getAuthHeader(),
    data: {},
  });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

test.describe.serial('Fleet failover: no move is left in moving', () => {
  let key: { id: string; value: string };
  const fakes: FakeReadyUp[] = [];
  const fleetIds: string[] = [];
  const cleanup: Array<() => Promise<void> | void> = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    key ??= await createFleetKey(request, { name: 'fleet-failover-stuck' });
    await request.delete('/api/tournament', { headers: getAuthHeader() });
    await setFailover(request, { auto: false, csm: false });
    await request.put('/api/fleet/autoscale/settings', {
      headers: getAuthHeader(),
      data: { enabled: false },
    });
  });

  test.afterEach(async ({ request }) => {
    while (cleanup.length) await cleanup.pop()?.();
    for (const f of fakes.splice(0)) f.close();
    await releaseFleet(request, fleetIds.splice(0));
    await setFailover(request, { auto: true, csm: true });
    await request.put('/api/fleet/autoscale/settings', {
      headers: getAuthHeader(),
      data: { enabled: true },
    });
  });

  /** A on a loaded match, then dead, with a free B; returns the open proposal. */
  async function deadServerWithSpare(request: APIRequestContext, slug: string) {
    const a = await FakeReadyUp.enroll(request, key.value);
    fakes.push(a);
    fleetIds.push(a.serverId);
    await a.hello();
    const cs2A = await link(request, a.serverId);
    await createMatch(request, slug);
    const assign = await acceptAssign(a, slug);
    await expect
      .poll(async () => (await matchRow(request, slug))?.status, { timeout: 20_000 })
      .toBe('loaded');
    a.availability('busy', 'assigned');
    a.snapshot(slug, assign.epoch as number);
    const b = await FakeReadyUp.enroll(request, key.value);
    fakes.push(b);
    fleetIds.push(b.serverId);
    await b.hello();
    const cs2B = await link(request, b.serverId);
    a.kill();
    // The platform's own pass (default grace) has run by now and made nothing to withdraw.
    await new Promise((r) => setTimeout(r, 1500));
    await expect
      .poll(
        async () => {
          await scan(request);
          return (await proposalOf(request, slug))?.status ?? null;
        },
        { timeout: 30_000 }
      )
      .toBe('open');
    const proposal = (await proposalOf(request, slug)) as { id: string };
    return { a, b, cs2A, cs2B, proposal };
  }

  test('a move that throws after the claim reopens the failover and keeps the old server', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const slug = `fleet-stuck-throw-${Date.now()}`;
    const { b, cs2A, cs2B, proposal } = await deadServerWithSpare(request, slug);

    // The write that points the match at B fails.
    psql(
      `CREATE OR REPLACE FUNCTION stb10_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stb10'; END $$`
    );
    psql(
      `CREATE TRIGGER stb10 BEFORE UPDATE OF server_id ON matches FOR EACH ROW WHEN (NEW.server_id = '${cs2B}') EXECUTE FUNCTION stb10_fail()`
    );
    cleanup.push(() => {
      psql('DROP TRIGGER IF EXISTS stb10 ON matches');
    });
    const res = await request.post(`/api/game/cs2/matches/${slug}/failover/${proposal.id}/accept`, {
      headers: getAuthHeader(),
      data: { targetServerId: cs2B },
    });
    expect(res.status(), await res.text()).toBe(500);

    expect((await proposalOf(request, slug))?.status).toBe('open');
    expect((await matchRow(request, slug))?.serverId).toBe(cs2A);

    // The same failover can be moved once the fault is gone.
    psql('DROP TRIGGER IF EXISTS stb10 ON matches');
    const again = request.post(`/api/game/cs2/matches/${slug}/failover/${proposal.id}/accept`, {
      headers: getAuthHeader(),
      data: { targetServerId: cs2B },
    });
    await acceptAssign(b, slug);
    expect((await again).status()).toBe(200);
    expect((await matchRow(request, slug))?.serverId).toBe(cs2B);
  });

  test('a moving row nobody carries out is opened again by the next pass', async ({ request }) => {
    test.setTimeout(120_000);
    const slug = `fleet-stuck-sweep-${Date.now()}`;
    const { cs2A, proposal } = await deadServerWithSpare(request, slug);

    psql(
      `UPDATE cs2_fleet_failovers SET status = 'moving', updated_at = updated_at - 600 WHERE id = '${proposal.id}'`
    );
    expect((await proposalOf(request, slug))?.status).toBe('moving');

    await scan(request);
    const after = await proposalOf(request, slug);
    expect(after).toMatchObject({ id: proposal.id, status: 'open' });
    expect(after?.lastError).toBeTruthy();
    expect((await matchRow(request, slug))?.serverId).toBe(cs2A);
  });
});
