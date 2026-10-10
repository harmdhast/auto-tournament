import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import { FakeReadyUp, STEAM, acceptAssign, createMatch, link } from '../helpers/fleetFake';
import { configureWebhook } from '../helpers/setup';
import { createTestServer, deleteServer } from '../helpers/servers';
import { adminCapabilitiesFor } from '../../api/src/integrations/cs2/routes/fleetCommands';

/**
 * What the RCON admin controls do on a Ready Up server: add round time is
 * cmd add_time on the assigned match; skip veto has no Ready Up equivalent.
 *
 * @tag api
 * @tag fleet
 */

test.describe.serial('Fleet: RCON parity', () => {
  let key: { id: string; value: string };
  const fakes: FakeReadyUp[] = [];
  let fake: FakeReadyUp;
  let cs2Id: string;
  let slug: string;
  let epoch: number;

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-parity-tests' });
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
  });

  test.afterAll(() => {
    for (const f of fakes) f.close();
  });

  test('add-time on a Ready Up server is cmd add_time on the assigned match', async ({
    request,
  }) => {
    fake = await FakeReadyUp.enroll(request, key.value);
    fakes.push(fake);
    await fake.hello({ availability: 'available' });
    cs2Id = await link(request, fake.serverId);
    slug = `parity-${Date.now()}`;
    await createMatch(request, slug);
    const assign = await acceptAssign(fake, slug);
    epoch = assign.epoch as number;
    fake.availability('busy', 'assigned');
    const p = request.post('/api/rcon/add-time', {
      headers: getAuthHeader(),
      data: { serverId: cs2Id, seconds: 30 },
    });
    const cmd = await fake.next('cmd');
    expect(cmd.payload).toMatchObject({
      name: 'add_time',
      args: { seconds: 30 },
      match_id: slug,
      epoch,
    });
    fake.answer(cmd, 'ok', { output: 'round_time=145' });
    expect(await (await p).json()).toMatchObject({
      success: true,
      transport: 'fleet',
      status: 'ok',
    });
  });

  test('add-time refuses 0 and 601 seconds', async ({ request }) => {
    for (const seconds of [0, 601, 'x']) {
      const res = await request.post('/api/rcon/add-time', {
        headers: getAuthHeader(),
        data: { serverId: cs2Id, seconds },
      });
      expect(res.status()).toBe(400);
    }
  });

  test('skip-veto stays 400 on Ready Up', async ({ request }) => {
    const res = await request.post('/api/rcon/skip-veto', {
      headers: getAuthHeader(),
      data: { serverId: cs2Id },
    });
    expect(res.status()).toBe(400);
  });

  test('fleet answers name the server; the connection test reads the fleet link', async ({
    request,
  }) => {
    const p = request.post('/api/rcon/say', {
      headers: getAuthHeader(),
      data: { serverId: cs2Id, message: 'hi' },
    });
    const cmd = await fake.next('cmd');
    fake.answer(cmd, 'ok');
    const body = await (await p).json();
    expect(body).toMatchObject({ success: true, transport: 'fleet' });
    expect(typeof body.serverName).toBe('string');
    expect(body.serverName.length).toBeGreaterThan(0);
    const t = await request.get(`/api/rcon/test/${cs2Id}`, { headers: getAuthHeader() });
    expect(t.status()).toBe(200);
    expect(await t.json()).toMatchObject({
      success: true,
      transport: 'fleet',
      online: true,
      serverName: body.serverName,
    });
  });

  test('capabilities: what each transport supports', async ({ request }) => {
    expect(adminCapabilitiesFor('fleet').matchControls).not.toContain('skipVeto');
    expect(adminCapabilitiesFor('fleet').matchControls).toContain('addTime');
    expect(adminCapabilitiesFor('fleet').commands).toEqual(['custom', 'kick', 'reset']);
    expect(adminCapabilitiesFor('rcon').matchControls).toHaveLength(11);
    expect(adminCapabilitiesFor('rcon').commands).toEqual(['custom']);
    const fleet = await (
      await request.get(`/api/rcon/capabilities/${cs2Id}`, { headers: getAuthHeader() })
    ).json();
    expect(fleet).toMatchObject({
      success: true,
      transport: 'fleet',
      commands: ['custom', 'kick', 'reset'],
    });
    const rcon = await createTestServer(request);
    expect(rcon).not.toBeNull();
    try {
      const body = await (
        await request.get(`/api/rcon/capabilities/${rcon!.id}`, { headers: getAuthHeader() })
      ).json();
      expect(body).toMatchObject({ success: true, transport: 'rcon' });
      expect(body.matchControls).toContain('skipVeto');
    } finally {
      await deleteServer(request, rcon!.id);
    }
    const none = await request.get('/api/rcon/capabilities/no-such-server', {
      headers: getAuthHeader(),
    });
    expect(none.status()).toBe(404);
  });

  test('a server detail lists the players its last snapshot reported', async ({ request }) => {
    const other = await FakeReadyUp.enroll(request, key.value);
    fakes.push(other);
    await other.hello({ availability: 'available' });
    const detail = async (id: string) =>
      request.get(`/api/fleet/servers/${id}`, { headers: getAuthHeader() });
    const empty = await (await detail(other.serverId)).json();
    expect(empty).toMatchObject({ success: true, server: { id: other.serverId, players: [] } });
    const players = [
      { steamid64: STEAM(1), name: 'alice', team: 'ct' },
      { steamid64: STEAM(2), name: 'bob', team: 'spectator' },
    ];
    other.snapshot('none', 1, { state: null, availability: 'available', players });
    await expect
      .poll(async () => (await (await detail(other.serverId)).json()).server.players)
      .toEqual(players);
    expect((await detail('no-such-server')).status()).toBe(404);
  });

  test('kick sends cmd kick without an assignment; bad input and offline servers are refused', async ({
    request,
  }) => {
    const idle = await FakeReadyUp.enroll(request, key.value);
    fakes.push(idle);
    const kick = (id: string, data: Record<string, unknown>) =>
      request.post(`/api/fleet/servers/${id}/kick`, { headers: getAuthHeader(), data });
    const offline = await kick(idle.serverId, { steamid64: STEAM(9) });
    expect(offline.status()).toBe(409);
    expect((await offline.json()).errorCode).toBe('offline');
    await idle.hello({ availability: 'available' });
    const p = kick(idle.serverId, { steamid64: STEAM(9), message: 'afk' });
    const cmd = await idle.next('cmd');
    expect(cmd.payload).toMatchObject({
      name: 'kick',
      args: { steamid64: STEAM(9), message: 'afk' },
    });
    expect(cmd.payload).not.toHaveProperty('match_id');
    idle.answer(cmd, 'ok');
    expect(await (await p).json()).toEqual({ ok: true });
    expect((await kick(idle.serverId, { steamid64: '123' })).status()).toBe(400);
    expect((await kick(idle.serverId, { steamid64: STEAM(9), message: 'a\u0007b' })).status()).toBe(
      400
    );
    expect((await kick('no-such-server', { steamid64: STEAM(9) })).status()).toBe(404);
  });
});
