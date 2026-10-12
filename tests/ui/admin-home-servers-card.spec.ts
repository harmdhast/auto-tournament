import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * The admin home's Servers card tells a spare server and a server busy for
 * another reason apart from one in a match; a draining server still
 * running a match counts as in a match.
 *
 * @tag ui
 * @tag servers
 */

const entry = (id: string, over: Record<string, unknown>) => ({
  id,
  name: id,
  online: true,
  status: null,
  matchSlug: null,
  matchNumber: null,
  matchRound: null,
  updatedAt: 1,
  inGraceWindow: false,
  secondsUntilReady: null,
  allocatable: false,
  notAllocatableReason: 'busy',
  busyReason: null,
  busyDetail: null,
  ...over,
});

test('spare and busy servers are not counted as in a match', async ({ page, request }) => {
  await setupTestContext(page, request);
  await page.route(
    (url) => url.pathname === '/api/tournament/server-availability',
    (route) =>
      route.fulfill({
        json: {
          success: true,
          availableServerCount: 1,
          gracePeriodSeconds: 0,
          nextAllocationInSeconds: null,
          requiredServerCount: 0,
          simulationEnabled: false,
          servers: [
            entry('free', { allocatable: true, notAllocatableReason: null }),
            entry('match', { matchSlug: 'r1m1' }),
            entry('local', { busyReason: 'local_match' }),
            entry('spare', { busyReason: 'reserved', notAllocatableReason: 'reserved' }),
            entry('drain', { busyReason: 'draining' }),
            entry('drain-match', { busyReason: 'draining', matchSlug: 'r1m2' }),
            entry('stuck', { busyReason: 'awaiting_reset' }),
            entry('down', { online: false, notAllocatableReason: 'offline' }),
          ],
        },
      })
  );
  await page.route(
    (url) => url.pathname === '/api/servers',
    (route) => route.fulfill({ json: { success: true, servers: [] } })
  );
  await page.goto('/');
  const card = page.getByTestId('admin-home-servers-card');
  const count = (k: string) => card.getByTestId(`admin-home-servers-${k}`);
  await expect(count('inMatch')).toHaveText('2');
  await expect(count('busy')).toHaveText('2');
  await expect(count('draining')).toHaveText('1');
  await expect(count('spare')).toHaveText('1');
  await expect(count('free')).toHaveText('1');
  await expect(count('offline')).toHaveText('1');
});
