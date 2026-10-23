import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import { FakeReadyUp } from '../helpers/fleetFake';

/**
 * Console commands by fleet id (POST /api/fleet/servers/:id/exec): root
 * admins, any enrolled server, linked or not.
 *
 * @tag api
 * @tag fleet
 */

const ADMIN_TOKEN = (process.env.API_TOKENS || 'ci-admin:ci-admin-token-0123456789abcdef')
  .split(',')[0]
  .split(':')
  .slice(1)
  .join(':');
const root = { Authorization: `Bearer ${ADMIN_TOKEN}` };

const exec = (request: APIRequestContext, id: string, command: string, headers = root) =>
  request.post(`/api/fleet/servers/${id}/exec`, { headers, data: { command } });

test.describe.serial('Fleet exec by id', () => {
  let key: { id: string; value: string };
  const fakes: FakeReadyUp[] = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-exec-by-id-tests' });
  });

  test.afterAll(() => {
    for (const f of fakes) f.close();
  });

  const online = async (request: APIRequestContext) => {
    const fake = await FakeReadyUp.enroll(request, key.value);
    fakes.push(fake);
    await fake.hello({ availability: 'available' });
    return fake;
  };

  test('root runs exec on an unlinked server', async ({ request }) => {
    const fake = await online(request);
    const res = exec(request, fake.serverId, 'status');
    const cmd = await fake.next('cmd');
    const payload = cmd.payload as { audit_id: string; issued_by: { root: boolean } };
    expect(cmd.payload).toMatchObject({ name: 'exec', args: { command: 'status' } });
    expect(payload.issued_by.root).toBe(true);
    expect(payload.audit_id).toMatch(/^[0-9A-Z]{26}$/);
    fake.answer(cmd, 'ok', { output: 'ok' });
    const response = await res;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      transport: 'fleet',
      response: 'ok',
      auditId: payload.audit_id,
    });
  });

  test('non-root gets 403', async ({ request }) => {
    const fake = await online(request);
    const res = await exec(request, fake.serverId, 'status', getAuthHeader() as typeof root);
    expect(res.status()).toBe(403);
  });

  test('multi-line command gets 400', async ({ request }) => {
    const fake = await online(request);
    const res = await exec(request, fake.serverId, 'status\nquit');
    expect(res.status()).toBe(400);
  });

  test('a carriage return or other control character gets 400', async ({ request }) => {
    const fake = await online(request);
    for (const command of ['status\rquit', 'status\u0000', 'say \u001b[2J']) {
      expect((await exec(request, fake.serverId, command)).status(), JSON.stringify(command)).toBe(
        400
      );
    }
  });

  test('unknown server gets 404', async ({ request }) => {
    const res = await exec(request, 'does-not-exist', 'status');
    expect(res.status()).toBe(404);
  });

  test('offline server gets 409', async ({ request }) => {
    const fake = await FakeReadyUp.enroll(request, key.value);
    fakes.push(fake);
    const res = await exec(request, fake.serverId, 'status');
    expect(res.status()).toBe(409);
    expect((await res.json()).errorCode).toBe('offline');
  });
});
