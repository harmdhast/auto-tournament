import { execFileSync } from 'child_process';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { recoverStuckMoves } from '../../api/src/integrations/cs2/fleet/failover';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import {
  FakeReadyUp,
  example,
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

/** Detection passes until `done` (the stuck-move sweep waits for the API to be up a while). */
async function scanUntil(request: APIRequestContext, done: () => boolean, timeout = 60_000) {
  await expect
    .poll(
      async () => {
        await scan(request);
        return done();
      },
      { timeout }
    )
    .toBe(true);
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
      psql('DROP FUNCTION IF EXISTS stb10_fail()');
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

    await scanUntil(
      request,
      () =>
        !psql(`SELECT status FROM cs2_fleet_failovers WHERE id = '${proposal.id}'`).startsWith(
          'moving'
        )
    );
    expect(
      psql(
        `SELECT status || '|' || last_error FROM cs2_fleet_failovers WHERE id = '${proposal.id}'`
      )
    ).toMatch(/^(open|withdrawn)\|The move was interrupted/);
    expect((await matchRow(request, slug))?.serverId).toBe(cs2A);
  });

  test('automatic moves that keep throwing stop after three, the failover waits for an admin', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    await setFailover(request, { auto: true, csm: false });
    const slug = `fleet-stuck-auto-${Date.now()}`;
    const a = await FakeReadyUp.enroll(request, key.value);
    fakes.push(a);
    fleetIds.push(a.serverId);
    await a.hello();
    await link(request, a.serverId);
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

    psql(
      `CREATE OR REPLACE FUNCTION stb10_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stb10'; END $$`
    );
    psql(
      `CREATE TRIGGER stb10 BEFORE UPDATE OF server_id ON matches FOR EACH ROW WHEN (NEW.server_id = '${cs2B}') EXECUTE FUNCTION stb10_fail()`
    );
    cleanup.push(() => {
      psql('DROP TRIGGER IF EXISTS stb10 ON matches');
      psql('DROP FUNCTION IF EXISTS stb10_fail()');
    });
    a.kill();
    // Attempts per failover: the platform's own pass (default grace) may withdraw one for the
    // server that just went down, and the next one starts its own count.
    const perFailover = () =>
      psql(`SELECT id FROM cs2_fleet_failovers WHERE match_slug = '${slug}'`)
        .split('\n')
        .filter(Boolean)
        .map((id) =>
          Number(
            psql(
              `SELECT count(*) FROM cs2_fleet_audit WHERE match_slug = '${slug}' AND command LIKE '%${id}%'`
            )
          )
        );
    await scanUntil(request, () => Math.max(0, ...perFailover()) >= 3);
    // Further passes try nothing more.
    for (let i = 0; i < 4; i++) await scan(request);
    expect(Math.max(...perFailover())).toBe(3);
    expect((await proposalOf(request, slug))?.status).toBe('open');
  });

  /**
   * What an API that died inside a move leaves: the failover `moving` (with the assignment and
   * live record it replaced), the match assigned to B at the next epoch, the old rows overwritten.
   */
  async function forgeInterruptedMove(
    request: APIRequestContext,
    slug: string,
    proposalId: string,
    b: FakeReadyUp,
    cs2B: string,
    opts: { ageS?: number; ended?: boolean } = {}
  ) {
    const assignment = JSON.parse(
      psql(
        `SELECT json_build_object('matchSlug', match_slug, 'epoch', epoch, 'serverId', server_id, 'cs2ServerId', cs2_server_id, 'password', password, 'config', config::json, 'endedAt', NULL) FROM cs2_fleet_assignments WHERE match_slug = '${slug}'`
      )
    );
    const live = await request.get(`/api/test/fleet/live-state/${slug}`, {
      headers: getAuthHeader(),
    });
    const record = (await live.json()).record;
    const prev = JSON.stringify({ assignment, record }).replace(/'/g, "''");
    const next = await request.post('/api/test/fleet/assign', {
      headers: getAuthHeader(),
      data: { matchSlug: slug, serverId: b.serverId },
    });
    expect(next.ok(), await next.text()).toBe(true);
    psql(
      `UPDATE cs2_fleet_assignments SET epoch = ${assignment.epoch + 1}, server_id = '${b.serverId}', cs2_server_id = '${cs2B}', password = 'new-pw', config = NULL WHERE match_slug = '${slug}'`
    );
    if (opts.ended)
      psql(
        `UPDATE cs2_fleet_assignments SET ended_at = EXTRACT(epoch FROM now())::integer WHERE match_slug = '${slug}'`
      );
    psql(`UPDATE matches SET server_id = '${cs2B}' WHERE slug = '${slug}'`);
    psql(
      `UPDATE cs2_fleet_failovers SET status = 'moving', target_cs2_server_id = '${cs2B}', prev_move = '${prev}', updated_at = updated_at - ${opts.ageS ?? 600} WHERE id = '${proposalId}'`
    );
    psql(
      `INSERT INTO cs2_fleet_audit (id, actor, server_id, match_slug, command, status) VALUES ('stb10-${slug}', 'test', '${b.serverId}', '${slug}', 'failover ${slug} (offline)', 'pending')`
    );
    return assignment as { epoch: number; password: string };
  }

  const failoverState = (id: string) =>
    psql(
      `SELECT status || '|' || coalesce(last_error, '') FROM cs2_fleet_failovers WHERE id = '${id}'`
    );
  const moved = (id: string) => () => !failoverState(id).startsWith('moving');

  /** The old server's rows are back and it keeps the match when it reconnects at its epoch. */
  async function expectOldServerRestored(
    request: APIRequestContext,
    slug: string,
    proposalId: string,
    a: FakeReadyUp,
    cs2A: string,
    before: { epoch: number; password: string }
  ) {
    await scanUntil(request, moved(proposalId));
    // Open again (the platform's own pass, with its grace, may withdraw it at once: the server just went down).
    expect(failoverState(proposalId)).toMatch(/^(open|withdrawn)\|The move was interrupted/);
    expect(
      psql(`SELECT prev_move IS NULL FROM cs2_fleet_failovers WHERE id = '${proposalId}'`)
    ).toBe('t');
    expect((await matchRow(request, slug))?.serverId).toBe(cs2A);
    expect(
      psql(
        `SELECT epoch || '|' || server_id || '|' || password || '|' || (ended_at IS NULL) || '|' || (config IS NOT NULL) FROM cs2_fleet_assignments WHERE match_slug = '${slug}'`
      )
    ).toBe(`${before.epoch}|${a.serverId}|${before.password}|true|true`);
    const live = await request.get(`/api/test/fleet/live-state/${slug}`, {
      headers: getAuthHeader(),
    });
    expect((await live.json()).record.epoch).toBe(before.epoch);
    expect(psql(`SELECT status FROM cs2_fleet_audit WHERE id = 'stb10-${slug}'`)).toBe('failed');

    // The old server comes back holding the match at its own epoch: it is not told to drop it.
    const state = JSON.parse(JSON.stringify(example('live.state.snapshot.json').payload.state));
    state.match_id = slug;
    state.epoch = before.epoch;
    await a.reconnect({ availability: 'busy', state });
    expect(await a.next('match.unassign', 4_000).catch(() => null)).toBeNull();
  }

  test('an interrupted move whose target never acked gives the old server its assignment and epoch back', async ({
    request,
  }) => {
    test.setTimeout(150_000);
    const slug = `fleet-stuck-unacked-${Date.now()}`;
    const { a, b, cs2A, cs2B, proposal } = await deadServerWithSpare(request, slug);
    const before = await forgeInterruptedMove(request, slug, proposal.id, b, cs2B);
    await expectOldServerRestored(request, slug, proposal.id, a, cs2A, before);
    expect((await b.next('match.unassign', 10_000)).payload).toMatchObject({ match_id: slug });
  });

  test('an interrupted move whose target epoch was already ended gives the old server its assignment back', async ({
    request,
  }) => {
    test.setTimeout(150_000);
    const slug = `fleet-stuck-ended-${Date.now()}`;
    const { a, b, cs2A, cs2B, proposal } = await deadServerWithSpare(request, slug);
    // assignMatch timed out and took the target's epoch back, then the API died before the undo.
    const before = await forgeInterruptedMove(request, slug, proposal.id, b, cs2B, {
      ended: true,
    });
    await expectOldServerRestored(request, slug, proposal.id, a, cs2A, before);
  });

  test('a move whose target is offline waits for it, then cancels what it never acked', async ({
    request,
  }) => {
    test.setTimeout(150_000);
    const slug = `fleet-stuck-offline-${Date.now()}`;
    const { b, cs2A, cs2B, proposal } = await deadServerWithSpare(request, slug);
    await forgeInterruptedMove(request, slug, proposal.id, b, cs2B, { ageS: 120 });
    b.kill();
    await new Promise((r) => setTimeout(r, 1500));
    for (let i = 0; i < 3; i++) await scan(request);
    expect(failoverState(proposal.id)).toMatch(/^moving\|/);
    await b.reconnect();
    await scanUntil(request, moved(proposal.id));
    expect(failoverState(proposal.id)).toMatch(/^(open|withdrawn)\|The move was interrupted/);
    expect((await matchRow(request, slug))?.serverId).toBe(cs2A);
  });

  test('after a long outage of the API, an offline target gets the wait from the API start, not from the claim', async ({
    request,
  }) => {
    test.setTimeout(150_000);
    const slug = `fleet-stuck-outage-${Date.now()}`;
    const { b, cs2B, proposal } = await deadServerWithSpare(request, slug);
    // Claimed 12 minutes ago; the API was down since, the target is still backing off its reconnects.
    await forgeInterruptedMove(request, slug, proposal.id, b, cs2B, { ageS: 720 });
    b.kill();
    await new Promise((r) => setTimeout(r, 1500));
    const now = Math.floor(Date.now() / 1000);
    // A sweep of an API that started 5 s ago (no delay applied: the sweep is called directly).
    await recoverStuckMoves(60, now, now - 5);
    expect(failoverState(proposal.id)).toMatch(/^moving\|/);
  });

  test('an interrupted move whose target acked the assignment is a finished move', async ({
    request,
  }) => {
    test.setTimeout(150_000);
    const slug = `fleet-stuck-acked-${Date.now()}`;
    const { b, cs2B, proposal } = await deadServerWithSpare(request, slug);
    const before = await forgeInterruptedMove(request, slug, proposal.id, b, cs2B);
    // The ack was replayed after the restart: the command says ok, the config was never stored.
    psql(
      `INSERT INTO cs2_fleet_commands (message_id, server_id, type, match_slug, epoch, status) VALUES ('stb10-cmd-${slug}', '${b.serverId}', 'match.assign', '${slug}', ${before.epoch + 1}, 'ok')`
    );
    psql(
      `UPDATE cs2_fleet_assignments SET sent_config = '{"marker":"sent","rules":{"demo":{"upload":false}}}' WHERE match_slug = '${slug}'`
    );

    await scanUntil(request, moved(proposal.id));
    expect(failoverState(proposal.id)).toBe('moved|');
    expect(
      psql(`SELECT prev_move IS NULL FROM cs2_fleet_failovers WHERE id = '${proposal.id}'`)
    ).toBe('t');
    expect((await matchRow(request, slug))?.serverId).toBe(cs2B);
    expect(psql(`SELECT config FROM cs2_fleet_assignments WHERE match_slug = '${slug}'`)).toContain(
      '"marker":"sent"'
    );
    expect(psql(`SELECT status FROM cs2_fleet_audit WHERE id = 'stb10-${slug}'`)).toBe('ok');
    expect(await b.next('match.unassign', 3_000).catch(() => null)).toBeNull();
  });
});
