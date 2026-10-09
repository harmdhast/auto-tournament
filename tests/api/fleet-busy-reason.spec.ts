import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import { FakeReadyUp } from '../helpers/fleetFake';
import { CS2_MIGRATIONS } from '../../api/src/integrations/cs2/migrations';
import { effectiveBusyReason, parseBusyDetail, parseBusyReason } from '../../api/src/integrations/cs2/fleet/busyReason';

/**
 * Why a Ready Up server takes no match (FLEET.md §8): the reason it reports with
 * its availability is kept per server and shown on the servers list and in the
 * pool status. Older Ready Up sends free text, read as no reason.
 *
 * @tag api
 * @tag fleet
 */

test.describe('Fleet busy reason: parsing', () => {
  test('only the known reasons are kept; legacy text is null', () => {
    expect(parseBusyReason('awaiting_reset')).toBe('awaiting_reset');
    expect(parseBusyReason('local_match')).toBe('local_match');
    expect(parseBusyReason('series_end')).toBeNull();
    expect(parseBusyReason('assigned')).toBeNull();
    expect(parseBusyReason('reserved')).toBeNull(); // platform-only
    expect(parseBusyReason(undefined)).toBeNull();
    expect(parseBusyReason(3)).toBeNull();
    expect(parseBusyDetail('x'.repeat(300))).toHaveLength(128);
    expect(parseBusyDetail('  cup\u0007-final ')).toBe('cup-final');
    expect(parseBusyDetail('')).toBeNull();
    expect(parseBusyDetail(null)).toBeNull();
  });

  test('match off and a held spare win over the stored reason in that order', () => {
    expect(effectiveBusyReason('local_match', { matchDisabled: true, reserved: false })).toBe('match_disabled');
    expect(effectiveBusyReason('local_match', { matchDisabled: false, reserved: true })).toBe('local_match');
    expect(effectiveBusyReason(null, { matchDisabled: false, reserved: true })).toBe('reserved');
    expect(effectiveBusyReason(null, { matchDisabled: false, reserved: false })).toBeNull();
  });

  test('the availability reason migration is declared last', () => {
    expect(CS2_MIGRATIONS.at(-1)?.id).toBe('037-fleet-availability-reason');
  });
});

type Row = { id: string; availability: string | null; availabilityReason: string | null; availabilityDetail: string | null };

async function row(request: APIRequestContext, fleetServerId: string): Promise<Row | undefined> {
  const res = await request.get('/api/fleet/servers', { headers: getAuthHeader() });
  const body = (await res.json()) as { servers: Row[] };
  return body.servers.find((s) => s.id === fleetServerId);
}

test.describe.serial('Fleet busy reason: kept per server', () => {
  let key: { id: string; value: string };
  const fakes: FakeReadyUp[] = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-busy-reason-tests' });
  });

  test.afterAll(() => {
    for (const f of fakes) f.close();
  });

  test('the busy reason follows hello, server.availability and snapshots', async ({ request }) => {
    const fake = await FakeReadyUp.enroll(request, key.value);
    fakes.push(fake);
    await fake.hello({ availability: 'busy', reason: 'local_match', detail: 'cup-final' });
    await expect
      .poll(() => row(request, fake.serverId))
      .toMatchObject({ availability: 'busy', availabilityReason: 'local_match', availabilityDetail: 'cup-final' });
    fake.availability('busy', 'awaiting_reset', { detail: 'm1' });
    await expect
      .poll(() => row(request, fake.serverId))
      .toMatchObject({ availabilityReason: 'awaiting_reset', availabilityDetail: 'm1' });
    fake.availability('busy', 'assigned'); // older Ready Up: free text
    await expect.poll(() => row(request, fake.serverId)).toMatchObject({ availabilityReason: null });
    fake.snapshot('m1', 1, { state: null, availability: 'busy', availability_reason: 'local_match', availability_detail: 'x' });
    await expect
      .poll(() => row(request, fake.serverId))
      .toMatchObject({ availabilityReason: 'local_match', availabilityDetail: 'x' });
    fake.availability('available', 'idle');
    await expect
      .poll(() => row(request, fake.serverId))
      .toMatchObject({ availability: 'available', availabilityReason: null, availabilityDetail: null });
  });
});
