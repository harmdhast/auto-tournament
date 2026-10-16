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
import {
  FakeCsm,
  createPendingHost,
  enrollHost,
  inventory,
  inventoryServer,
  newMachineId,
} from '../helpers/fleetHost';

/**
 * csm's `host.health` belongs to the match the server held when it was sent
 * (fleet/failover.ts): a `hung` reported while the server was idle, whose
 * `recovered` never arrived, does not fail the next match over.
 *
 * @tag api
 * @tag fleet
 */
test.describe.serial('Fleet failover: a stale csm health signal', () => {
  let key: { id: string; value: string };
  const fakes: FakeReadyUp[] = [];
  const csms: FakeCsm[] = [];
  const fleetIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    key ??= await createFleetKey(request, { name: 'fleet-failover-health' });
    await request.delete('/api/tournament', { headers: getAuthHeader() });
    for (const data of [{ auto: false, csm: false }]) {
      const res = await request.put('/api/fleet/failover/settings', {
        headers: getAuthHeader(),
        data,
      });
      expect(res.ok(), await res.text()).toBe(true);
    }
    await request.put('/api/fleet/autoscale/settings', {
      headers: getAuthHeader(),
      data: { enabled: false },
    });
  });

  test.afterEach(async ({ request }) => {
    for (const c of csms.splice(0)) c.close();
    for (const f of fakes.splice(0)) f.close();
    await releaseFleet(request, fleetIds.splice(0));
    await request.put('/api/fleet/failover/settings', {
      headers: getAuthHeader(),
      data: { auto: true, csm: true },
    });
    await request.put('/api/fleet/autoscale/settings', {
      headers: getAuthHeader(),
      data: { enabled: true },
    });
  });

  async function scan(request: APIRequestContext) {
    const res = await request.post('/api/test/fleet/failover/scan', {
      headers: getAuthHeader(),
      data: {},
    });
    expect(res.ok(), await res.text()).toBe(true);
    return res.json();
  }

  async function hostWith(request: APIRequestContext, a: FakeReadyUp) {
    const pending = await createPendingHost(request, 'failover-health');
    const machineId = newMachineId();
    const res = await enrollHost(request, { code: pending.code }, machineId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const csm = await FakeCsm.connect(res.body.token, res.body.host_id, machineId);
    csms.push(csm);
    await csm.handshake();
    csm.sendEphemeral(
      'host.inventory',
      inventory(res.body.host_id, [
        inventoryServer('server-1', {
          readyup: { installed: '0.5.0', install_id: a.installId, health: 'ok', phase: 'idle' },
        }),
      ])
    );
    await expect
      .poll(async () => {
        const host = (
          await (
            await request.get(`/api/fleet/hosts/${res.body.host_id}`, { headers: getAuthHeader() })
          ).json()
        ).host;
        return host.servers?.[0]?.fleetServer?.id ?? null;
      })
      .toBe(a.serverId);
    return csm;
  }

  test('a hung signal from before the assignment does not open a failover on the new match', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const a = await FakeReadyUp.enroll(request, key.value);
    fakes.push(a);
    fleetIds.push(a.serverId);
    await a.hello();
    await link(request, a.serverId);
    const csm = await hostWith(request, a);

    // The server was hung while idle; csm's `recovered` never arrived.
    const hung = csm.sendReliable('host.health', {
      server: 'server-1',
      event: 'hung',
      detail: '/health silent for 30 s',
    });
    await csm.acked(hung.seq as number);
    await new Promise((r) => setTimeout(r, 2500));

    const slug = `fleet-health-${Date.now()}`;
    await createMatch(request, slug);
    const assign = await acceptAssign(a, slug);
    await expect
      .poll(async () => (await matchRow(request, slug))?.status, { timeout: 20_000 })
      .toBe('loaded');
    a.availability('busy', 'assigned');
    a.snapshot(slug, assign.epoch as number);

    const result = await scan(request);
    expect(result.proposed.filter((p: { matchSlug: string }) => p.matchSlug === slug)).toEqual([]);
    const view = await (
      await request.get(`/api/game/cs2/matches/${slug}/failover`, { headers: getAuthHeader() })
    ).json();
    expect(view.proposal).toBeNull();
  });

  test('a hung signal sent while the match is on the server opens a failover that a refused move does not withdraw', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const a = await FakeReadyUp.enroll(request, key.value);
    fakes.push(a);
    fleetIds.push(a.serverId);
    await a.hello();
    await link(request, a.serverId);
    const csm = await hostWith(request, a);
    const slug = `fleet-health-live-${Date.now()}`;
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

    const hung = csm.sendReliable('host.health', { server: 'server-1', event: 'hung' });
    await csm.acked(hung.seq as number);
    const view = async () =>
      (
        await (
          await request.get(`/api/game/cs2/matches/${slug}/failover`, { headers: getAuthHeader() })
        ).json()
      ).proposal as { id: string; status: string; reason: string } | null;
    await expect
      .poll(
        async () => {
          await scan(request);
          return (await view())?.status ?? null;
        },
        { timeout: 20_000 }
      )
      .toBe('open');
    const proposal = (await view()) as { id: string; reason: string };
    expect(proposal.reason).toBe('hung');

    // B refuses the move: the assignment is restored, the failover stays.
    const moving = request.post(`/api/game/cs2/matches/${slug}/failover/${proposal.id}/accept`, {
      headers: getAuthHeader(),
      data: { targetServerId: cs2B },
    });
    const offered = await b.next('match.assign', 30_000);
    b.answer(offered, 'rejected', { error: { code: 'busy', message: 'busy' } });
    expect((await moving).status()).toBe(502);
    await scan(request);
    expect((await view())?.status).toBe('open');
  });
});
