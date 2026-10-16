import { execFileSync } from 'child_process';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import { FakeReadyUp } from '../helpers/fleetFake';
import {
  FakeCsm,
  createPendingHost,
  enrollHost,
  inventory,
  inventoryServer,
  newMachineId,
} from '../helpers/fleetHost';

/**
 * A disruptive command queued for an offline machine (fleet/hosts/service.ts):
 * - carries an expiry (`expires_at`): 10 min, 2 min for the platform's own forced ones;
 * - when the machine comes back, one past its expiry, or one not forced whose server
 *   is busy with a match by then, is sent as expired (csm answers `expired`, it is not run).
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

test.describe.serial('Fleet host: commands queued for an offline machine', () => {
  let key: { id: string; value: string };
  const fakes: FakeReadyUp[] = [];
  const csms: FakeCsm[] = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    key ??= await createFleetKey(request, { name: 'fleet-host-queued' });
  });

  test.afterEach(() => {
    for (const c of csms.splice(0)) c.close();
    for (const f of fakes.splice(0)) f.close();
  });

  /** A machine whose server-1 is Ready Up server `a`; csm goes offline again. */
  async function offlineMachine(request: APIRequestContext) {
    const a = await FakeReadyUp.enroll(request, key.value);
    fakes.push(a);
    await a.hello();
    const pending = await createPendingHost(request, 'queued-commands');
    const machineId = newMachineId();
    const res = await enrollHost(request, { code: pending.code }, machineId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const hostId = res.body.host_id as string;
    const csm = await FakeCsm.connect(res.body.token, hostId, machineId);
    await csm.handshake();
    csm.sendEphemeral(
      'host.inventory',
      inventory(hostId, [
        inventoryServer('server-1', {
          readyup: { installed: '0.5.0', install_id: a.installId, health: 'ok', phase: 'idle' },
        }),
      ])
    );
    await expect
      .poll(async () => {
        const host = (
          await (
            await request.get(`/api/fleet/hosts/${hostId}`, { headers: getAuthHeader() })
          ).json()
        ).host;
        return host.servers?.[0]?.fleetServer?.id ?? null;
      })
      .toBe(a.serverId);
    csm.close();
    await csm.client.waitClosed();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/fleet/hosts/${hostId}`, { headers: getAuthHeader() })
            ).json()
          ).host.online
      )
      .toBeFalsy();
    return { a, hostId, token: res.body.token as string, machineId };
  }

  async function queueRestart(
    request: APIRequestContext,
    hostId: string,
    force?: { reason: string }
  ) {
    const res = await request.post(`/api/fleet/hosts/${hostId}/commands`, {
      headers: getAuthHeader(),
      data: {
        type: 'server.restart',
        payload: { server: 'server-1', reason: 'queued test' },
        ...(force ? { force } : {}),
      },
    });
    expect(res.status(), await res.text()).toBe(202);
    const body = await res.json();
    expect(body.delivered).toBe(false);
    return body.command as { id: string };
  }

  async function reconnect(m: { hostId: string; token: string; machineId: string }) {
    const csm = await FakeCsm.connect(m.token, m.hostId, m.machineId);
    csms.push(csm);
    await csm.handshake();
    return csm;
  }

  test('a queued disruptive command carries an expiry', async ({ request }) => {
    const m = await offlineMachine(request);
    const before = Date.now();
    await queueRestart(request, m.hostId);
    const csm = await reconnect(m);
    const sent = await csm.nextCommand('server.restart');
    const expiresAt = (sent.payload as { expires_at: number }).expires_at;
    expect(expiresAt).toBeGreaterThan(before + 9 * 60_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
  });

  test('a command not forced is not run when its server got a match meanwhile', async ({
    request,
  }) => {
    const m = await offlineMachine(request);
    const command = await queueRestart(request, m.hostId);
    m.a.availability('busy', 'assigned');
    await new Promise((r) => setTimeout(r, 500));
    const csm = await reconnect(m);
    const sent = await csm.nextCommand('server.restart');
    expect(sent.id).toBe(command.id);
    expect((sent.payload as { expires_at: number }).expires_at).toBeLessThanOrEqual(Date.now());
    const record = (
      await (
        await request.get(`/api/fleet/hosts/${m.hostId}/commands/${command.id}`, {
          headers: getAuthHeader(),
        })
      ).json()
    ).command;
    expect(record).toMatchObject({ status: 'failed', errorCode: 'match_in_progress' });
  });

  test('a command past its expiry is sent as expired, forced or not', async ({ request }) => {
    const m = await offlineMachine(request);
    const command = await queueRestart(request, m.hostId, { reason: 'test' });
    // It waited past its expiry (set to 2 here; the platform sends 1).
    psql(
      `UPDATE cs2_fleet_host_outbox SET message = jsonb_set(message::jsonb, '{payload,expires_at}', '2')::text WHERE host_id = '${m.hostId}' AND type = 'server.restart'`
    );
    const csm = await reconnect(m);
    const sent = await csm.nextCommand('server.restart');
    expect(sent.id).toBe(command.id);
    expect((sent.payload as { expires_at: number }).expires_at).toBe(1);
    const record = (
      await (
        await request.get(`/api/fleet/hosts/${m.hostId}/commands/${command.id}`, {
          headers: getAuthHeader(),
        })
      ).json()
    ).command;
    expect(record).toMatchObject({ status: 'failed', errorCode: 'expired' });
  });
});
