import { test, expect, type Page } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * The Manage page's server tiles: a server in a match says its phase, map and
 * score and opens the match; the tiles sort by status with matches first.
 *
 * @tag ui
 * @tag fleet
 */

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  online: true,
  status: null,
  matchSlug: null,
  matchNumber: null,
  matchRound: null,
  updatedAt: Math.floor(Date.now() / 1000),
  inGraceWindow: false,
  secondsUntilReady: null,
  allocatable: false,
  notAllocatableReason: 'busy',
  busyReason: null,
  busyDetail: null,
  ...over,
});

const match = (slug: string, over: Record<string, unknown> = {}) => ({
  id: 1,
  slug,
  status: 'live',
  round: 1,
  matchNumber: 1,
  team1: { id: 't1', name: 'Alpha' },
  team2: { id: 't2', name: 'Bravo' },
  maps: ['de_inferno'],
  mapNumber: 0,
  currentMap: 'de_inferno',
  matchPhase: 'live',
  vetoCompleted: true,
  team1MapScore: 7,
  team2MapScore: 5,
  ...over,
});

async function mockFleet(page: Page, servers: unknown[], matches: Record<string, unknown>) {
  await page.route('**/api/tournament/server-availability', (route) =>
    route.fulfill({
      json: {
        success: true,
        availableServerCount: 0,
        gracePeriodSeconds: 0,
        nextAllocationInSeconds: null,
        requiredServerCount: 0,
        simulationEnabled: false,
        servers,
      },
    })
  );
  await page.route('**/api/matches/*', (route) => {
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
    const found = matches[slug];
    return found ? route.fulfill({ json: { success: true, match: found } }) : route.continue();
  });
}

test('a server in a match shows its phase, map and score and opens the match', async ({ page }) => {
  await ensureSignedIn(page);
  await mockFleet(
    page,
    [
      entry('s-live', {
        matchSlug: 'ub-r1-m1',
        matchRound: 1,
        matchNumber: 1,
        matchBracket: 'WB',
        notAllocatableReason: null,
      }),
      entry('s-warm', { matchSlug: 'friendly', notAllocatableReason: null }),
      entry('s-free', { allocatable: true, notAllocatableReason: null }),
    ],
    {
      'ub-r1-m1': match('ub-r1-m1'),
      friendly: match('friendly', {
        matchPhase: 'warmup',
        team1MapScore: 0,
        team2MapScore: 0,
      }),
    }
  );
  await page.goto('/manage');
  const grid = page.getByTestId('manage-servers');
  const live = grid.getByRole('button', { name: /s-live/ });
  await expect(live).toBeVisible({ timeout: 15000 });
  await expect(live).toContainText('Live');
  await expect(live).toContainText('UB R1 M1 · de_inferno 7 – 5');
  const warm = grid.getByRole('button', { name: /s-warm/ });
  await expect(warm).toContainText('Warmup');
  await expect(warm).toContainText('Alpha vs Bravo · de_inferno');
  await expect(warm).not.toContainText('0 – 0');
  await expect(grid.getByRole('button', { name: /s-free/ })).toHaveCount(0);
  await expect(grid.getByText('Free', { exact: true })).toBeVisible();

  await live.click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('server tiles sort by status, matches first', async ({ page }) => {
  await ensureSignedIn(page);
  await mockFleet(
    page,
    [
      entry('a-offline', { online: false, updatedAt: 1 }),
      entry('b-free', { allocatable: true, notAllocatableReason: null }),
      entry('c-spare', { busyReason: 'reserved', notAllocatableReason: 'reserved' }),
      entry('d-warm', { matchSlug: 'm-warm', notAllocatableReason: null }),
      entry('e-live', { matchSlug: 'm-live', notAllocatableReason: null }),
      entry('f-busy', { busyReason: 'draining' }),
    ],
    {
      'm-warm': match('m-warm', { matchPhase: 'warmup' }),
      'm-live': match('m-live'),
    }
  );
  await page.route('**/api/servers', (route) =>
    route.fulfill({
      json: {
        success: true,
        servers: [{ id: 'u1', name: 'z-new', enabled: true, lastSeen: null }],
      },
    })
  );
  await page.goto('/manage');
  const grid = page.getByTestId('manage-servers');
  await expect(grid.getByText('e-live')).toBeVisible({ timeout: 15000 });
  await expect(grid.locator('b')).toHaveText([
    'e-live',
    'd-warm',
    'b-free',
    'c-spare',
    'f-busy',
    'a-offline',
    'z-new',
  ]);
});
