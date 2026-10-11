import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'child_process';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import { FakeReadyUp, createMatch, link } from '../helpers/fleetFake';

/**
 * A Ready Up server reporting a platform assignment (reason assigned or
 * awaiting_reset) for a match the platform no longer runs gets match.unassign.
 *
 * @tag api
 * @tag fleet
 */

const auditRows = (slug: string): string =>
  execFileSync(
    'podman',
    [
      'exec',
      'auto-tournament-postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'auto_tournament',
      '-At',
      '-c',
      `SELECT actor || '|' || command || '|' || status FROM cs2_fleet_audit WHERE match_slug = '${slug}'`,
    ],
    { encoding: 'utf8' }
  ).trim();

const setState = async (
  request: APIRequestContext,
  slug: string,
  status: string,
  serverId: string | null
) => {
  const res = await request.post('/api/test/match-state', {
    headers: getAuthHeader(),
    data: { slug, status, serverId },
  });
  expect(res.ok(), await res.text()).toBe(true);
};

test.describe.serial('Fleet orphan unassign', () => {
  let key: { id: string; value: string };
  const fakes: FakeReadyUp[] = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-orphan-tests' });
  });

  test.afterAll(() => {
    for (const f of fakes) f.close();
  });

  const online = async (request: APIRequestContext) => {
    const fake = await FakeReadyUp.enroll(request, key.value);
    fakes.push(fake);
    await fake.hello({ availability: 'busy' });
    const cs2Id = await link(request, fake.serverId);
    return { fake, cs2Id };
  };

  const report = (fake: FakeReadyUp, slug: string, epoch = 1, reason = 'assigned') =>
    fake.snapshot(slug, epoch, {
      availability: 'busy',
      availability_reason: reason,
      availability_detail: slug,
    });

  test('unknown slug is unassigned', async ({ request }) => {
    const { fake } = await online(request);
    const slug = `ghost-${Date.now()}`;
    report(fake, slug);
    const msg = await fake.next('match.unassign');
    expect(msg.payload).toMatchObject({ match_id: slug, epoch: 1, reason: 'cancelled' });
    fake.answer(msg, 'ok');
    await expect.poll(() => auditRows(slug)).toBe(`system|match.unassign ${slug} (cancelled)|ok`);
  });

  test('completed match is unassigned as ended', async ({ request }) => {
    const { fake, cs2Id } = await online(request);
    const slug = `orphan-done-${Date.now()}`;
    await createMatch(request, slug);
    await setState(request, slug, 'completed', cs2Id);
    report(fake, slug, 2, 'awaiting_reset');
    const msg = await fake.next('match.unassign');
    expect(msg.payload).toMatchObject({ match_id: slug, epoch: 2, reason: 'ended' });
    fake.answer(msg, 'ok');
  });

  test('match on another server is superseded', async ({ request }) => {
    const { fake } = await online(request);
    const other = await online(request);
    const slug = `orphan-moved-${Date.now()}`;
    await createMatch(request, slug);
    await setState(request, slug, 'live', other.cs2Id);
    report(fake, slug);
    const msg = await fake.next('match.unassign');
    expect(msg.payload).toMatchObject({ match_id: slug, reason: 'superseded' });
    fake.answer(msg, 'ok');
  });

  test('live match on this server is kept', async ({ request }) => {
    const { fake, cs2Id } = await online(request);
    const slug = `orphan-live-${Date.now()}`;
    await createMatch(request, slug);
    await setState(request, slug, 'live', cs2Id);
    report(fake, slug);
    await expect(fake.next('match.unassign', 2000)).rejects.toThrow();
  });

  test('local_match with unknown slug is kept', async ({ request }) => {
    const { fake } = await online(request);
    report(fake, `local-${Date.now()}`, 1, 'local_match');
    await expect(fake.next('match.unassign', 2000)).rejects.toThrow();
  });

  test('hello with an orphan assignment is unassigned', async ({ request }) => {
    const { fake } = await online(request);
    const slug = `ghost-hello-${Date.now()}`;
    await fake.reconnect({
      availability: 'busy',
      reason: 'assigned',
      detail: slug,
      state: {
        match_id: slug,
        epoch: 3,
        live_rev: 0,
      } as never,
    });
    const msg = await fake.next('match.unassign');
    expect(msg.payload).toMatchObject({ match_id: slug, epoch: 3, reason: 'cancelled' });
    fake.answer(msg, 'ok');
  });

  test('same orphan is unassigned once per connection', async ({ request }) => {
    const { fake } = await online(request);
    const slug = `ghost-once-${Date.now()}`;
    report(fake, slug);
    fake.answer(await fake.next('match.unassign'), 'ok');
    report(fake, slug);
    await expect(fake.next('match.unassign', 2000)).rejects.toThrow();
    await fake.reconnect({ availability: 'busy', reason: 'assigned', detail: slug, state: null });
    // no state and no assignment row: nothing to address
    await expect(fake.next('match.unassign', 2000)).rejects.toThrow();
  });

  test('a stale epoch on an orphan match gets one match.unassign, not two', async ({ request }) => {
    const { fake, cs2Id } = await online(request);
    const slug = `orphan-stale-${Date.now()}`;
    await createMatch(request, slug);
    report(fake, slug, 2, 'idle');
    await setState(request, slug, 'completed', cs2Id);
    await fake.reconnect({
      availability: 'busy',
      reason: 'assigned',
      detail: slug,
      state: { match_id: slug, epoch: 1, live_rev: 0 } as never,
    });
    const msg = await fake.next('match.unassign');
    expect(msg.payload).toMatchObject({ match_id: slug, epoch: 1 });
    fake.answer(msg, 'ok');
    await expect(fake.next('match.unassign', 2000)).rejects.toThrow();
  });
});
