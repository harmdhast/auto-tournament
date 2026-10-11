import { test, expect, type Page } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import {
  fleetServer,
  machineHost,
  stubFleet,
  stubFleetDetail,
  stubMachines,
} from '../helpers/fleetUi';

/**
 * The Servers tab lists every server once, grouped by machine: a machine
 * server running Ready Up is one row on its machine; Ready Up servers on no
 * machine, then RCON servers, are under No machine. Rows are one line on a
 * desktop and two on a phone; Reset shows on a busy row only.
 *
 * @tag ui
 * @tag servers
 */

const MACHINE_ROW = 'server-row-m:m1:server-1';

async function stubAll(page: Page, fleetOver: Record<string, Record<string, unknown>> = {}) {
  const fleet = [
    fleetServer('a', {
      availability: 'busy',
      availabilityReason: 'local_match',
      availabilityDetail: 'cup-final',
      ...fleetOver.a,
    }),
    fleetServer('b', {
      connect: { address: '203.0.113.5:27015', host: '203.0.113.5', port: 27015, source: 'peer' },
      ...fleetOver.b,
    }),
    fleetServer('c', { availability: 'busy', availabilityReason: 'coffee', ...fleetOver.c }),
  ];
  await stubMachines(page, [machineHost('m1', [{ name: 'server-1', fleetId: 'a' }])]);
  await stubFleet(page, fleet);
  await stubFleetDetail(page, fleet);
  await page.route(
    (url) => url.pathname === '/api/servers',
    (route) =>
      route.fulfill({
        json: {
          success: true,
          servers: [
            {
              id: 'rc1',
              name: 'rcon-legacy',
              host: '10.0.0.9',
              port: 27015,
              enabled: true,
              transport: 'rcon',
              status: 'online',
            },
          ],
        },
      })
  );
  await page.route(
    (url) => /^\/api\/fleet\/servers\/[^/]+\/push$/.test(url.pathname),
    (route) => {
      const id = new URL(route.request().url()).pathname.split('/')[4];
      const status = id === 'b' ? 'failed' : 'ok';
      const item = {
        at: 1,
        rev: 1,
        acked: true,
        status,
        errorCode: null,
        message: null,
        output: null,
      };
      return route.fulfill({
        json: {
          success: true,
          serverId: id,
          online: true,
          settingsRev: 1,
          override: null,
          effective: {},
          whitelist: null,
          practice: null,
          plugins: null,
          pluginSet: null,
          pluginsState: null,
          pushed: {
            admins: item,
            serverConfig: null,
            settings: item,
            whitelist: null,
            practice: null,
            plugins: null,
          },
        },
      });
    }
  );
}

interface StubMatch {
  slug: string;
  status?: string;
  allocatable?: boolean;
  vetoing?: boolean;
  vetoCompleted?: boolean;
  matchPhase: string | null;
  team1MapScore?: number;
  team2MapScore?: number;
  team1SeriesScore?: number;
  team2SeriesScore?: number;
  currentMap?: string;
  mapNumber?: number;
  maps?: string[];
}

/** Which match each cs2_servers id plays, and what GET /api/matches/:slug says of it. */
async function stubMatches(page: Page, byServer: Record<string, StubMatch>) {
  await page.route(
    (url) => url.pathname === '/api/tournament/server-availability',
    (route) =>
      route.fulfill({
        json: {
          success: true,
          servers: Object.entries(byServer).map(([id, m]) => ({
            id,
            matchSlug: m.slug,
            allocatable: m.allocatable ?? false,
          })),
        },
      })
  );
  await page.route(
    (url) => /^\/api\/matches\/[^/]+$/.test(url.pathname),
    (route) => {
      const slug = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);
      const m = Object.values(byServer).find((x) => x.slug === slug);
      if (!m) return route.fulfill({ status: 404, json: { success: false } });
      return route.fulfill({
        json: {
          success: true,
          match: {
            id: 7,
            matchNumber: 7,
            round: 1,
            status: 'live',
            vetoCompleted: true,
            vetoing: false,
            team1: { id: 't1', name: 'Team A' },
            team2: { id: 't2', name: 'Team B' },
            team1MapScore: 0,
            team2MapScore: 0,
            ...m,
          },
        },
      });
    }
  );
}

test.describe('Server list', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('every server is listed once, grouped by machine', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers');
    const machine = page.getByTestId('server-group-m1');
    await expect(machine.getByTestId(MACHINE_ROW)).toContainText('ru-a');
    await expect(machine.getByTestId(MACHINE_ROW)).toContainText(
      'Local match cup-final still loaded'
    );
    const none = page.getByTestId('server-group-none');
    const keys = await none
      .locator('[data-testid^="server-row-"][role="listitem"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(keys).toEqual(['server-row-r:b', 'server-row-r:c', 'server-row-x:rc1']);
    await expect(page.getByTestId('server-row-r:a')).toHaveCount(0);
  });

  test('the header counts every listed server', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-x:rc1')).toBeVisible();
    await expect(page.getByTestId('servers-limit')).toContainText('1 machine · 4 servers');
  });

  test('back leaves an old fleetServer link', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-x:rc1')).toBeVisible();
    await page.goto('/manage/servers?fleetServer=b');
    await expect(page).toHaveURL(/[?&]server=r%3Ab/);
    await page.goBack();
    await expect(page).toHaveURL(/\/manage\/servers$/);
  });

  test('the header counts active servers only', async ({ page }) => {
    await stubAll(page);
    const fleet = [
      fleetServer('a', { availability: 'busy', availabilityReason: 'local_match' }),
      fleetServer('b'),
      fleetServer('c'),
      fleetServer('d', { status: 'revoked', online: false }),
    ];
    await stubFleet(page, fleet);
    await page.route(
      (url) => url.pathname === '/api/servers',
      (route) =>
        route.fulfill({
          json: {
            success: true,
            servers: [
              {
                id: 'rc1',
                name: 'rcon-legacy',
                host: '10.0.0.9',
                port: 27015,
                enabled: true,
                transport: 'rcon',
              },
              {
                id: 'rc2',
                name: 'rcon-off',
                host: '10.0.0.8',
                port: 27015,
                enabled: false,
                transport: 'rcon',
              },
            ],
          },
        })
    );
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-r:d')).toBeVisible();
    await expect(page.getByTestId('servers-limit')).toContainText('1 machine · 4 servers');
  });

  test('machine rows keep their health lines', async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    await stubMachines(page, [
      machineHost('m1', [
        { name: 'server-1', process: { running: false } },
        { name: 'server-2', process: { restarts_24h: 2 } },
      ]),
      machineHost('m2', [{ name: 'server-1' }], {
        commands: [
          {
            id: 'c1',
            hostId: 'm2',
            seq: 4,
            type: 'host.update_game',
            server: null,
            payload: {},
            status: 'pending',
            errorCode: null,
            errorMessage: null,
            output: null,
            progress: { step: 'Downloading CS2', pct: 40, at: now },
            issuedBy: null,
            forcedBy: null,
            forceReason: null,
            createdAt: now,
            answeredAt: null,
          },
        ],
      }),
      machineHost('m3', [{ name: 'server-1' }], { online: false, lastSeen: now - 600 }),
    ]);
    await stubFleet(page, []);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-m:m1:server-1')).toContainText(
      'Starts when a match needs it'
    );
    await expect(page.getByTestId('server-row-m:m1:server-2')).toContainText('2 restarts in 24 h');
    await expect(page.getByTestId('server-row-m:m2:server-1')).toContainText('Downloading CS2');
    await expect(page.getByTestId('server-row-m:m3:server-1')).toContainText(
      'Its machine is offline'
    );
  });

  test('push state is read for enrolled servers only', async ({ page }) => {
    await stubAll(page);
    await stubFleet(page, [
      fleetServer('b'),
      fleetServer('p', { status: 'pending', online: false }),
    ]);
    let pendingReads = 0;
    await page.route(
      (url) => url.pathname === '/api/fleet/servers/p/push',
      (route) => {
        pendingReads += 1;
        return route.fulfill({ status: 404, json: { success: false } });
      }
    );
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-push-r:b')).toBeVisible();
    expect(pendingReads).toBe(0);
  });

  test('dots follow the availability colours', async ({ page }) => {
    await stubAll(page);
    const fleet = [
      fleetServer('a', { availability: 'busy', availabilityReason: 'local_match' }),
      fleetServer('b'),
      fleetServer('d', { availabilityReason: 'reserved' }),
      fleetServer('e', { availability: 'busy', availabilityReason: 'awaiting_reset' }),
      fleetServer('o', { online: false }),
    ];
    await stubFleet(page, fleet);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-r:o')).toBeVisible();
    const color = (key: string, part: 'dot' | 'state') =>
      page
        .getByTestId(`server-row-${part}-${key}`)
        .locator(part === 'dot' ? ':scope > *' : '.MuiChip-root')
        .first()
        .evaluate(
          (e, p) =>
            p === 'dot'
              ? window.getComputedStyle(e).backgroundColor
              : window.getComputedStyle(e).color,
          part
        );
    const keys = ['m:m1:server-1', 'r:b', 'r:d', 'r:e', 'r:o'];
    const dots = await Promise.all(keys.map((k) => color(k, 'dot')));
    expect(new Set(dots).size).toBe(5);
    // Not free: the chip text takes the dot's colour.
    for (const k of ['m:m1:server-1', 'r:d', 'r:e', 'r:o'])
      expect(await color(k, 'state')).toBe(dots[keys.indexOf(k)]);
  });

  test('clicking an address copies the connect command', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubAll(page);
    await page.goto('/manage/servers');
    await page.getByTestId('server-row-address-r:b').getByRole('button').click();
    await expect(page.getByText('Connect command copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'connect 203.0.113.5:27015'
    );
    await expect(page).not.toHaveURL(/server=/);
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.getByTestId('server-row-r:b').click();
    await page
      .getByTestId('server-panel')
      .getByRole('button', { name: /203\.0\.113\.5:27015/ })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'connect 203.0.113.5:27015'
    );
  });

  test('a pending server state is not cut', async ({ page }) => {
    await stubAll(page);
    await stubFleet(page, [fleetServer('p', { status: 'pending', online: false })]);
    await page.goto('/manage/servers');
    const chip = page.getByTestId('server-row-state-r:p').locator('.MuiChip-label');
    await expect(chip).toHaveText('Waiting to enroll');
    expect(await chip.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  });

  test('cut text shows in full on hover', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubAll(page, {
      b: { name: 'a-ready-up-server-with-a-name-far-too-long-for-its-column' },
    });
    await page.goto('/manage/servers');
    const row = page.getByTestId('server-row-r:b');
    await expect(
      row.locator('[title="a-ready-up-server-with-a-name-far-too-long-for-its-column"]')
    ).toHaveCount(1);
    const machine = page.getByTestId('server-row-m:m1:server-1');
    await expect(machine.locator('[title="Local match cup-final still loaded"]')).toHaveCount(1);
    await expect(machine.locator('[title="Busy"]')).toHaveCount(1);
  });

  test('reset shows inline only on a busy Ready Up server', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers');
    await expect(page.getByTestId(`server-row-reset-m:m1:server-1`)).toBeVisible();
    await expect(page.getByTestId('server-row-reset-r:b')).toHaveCount(0);
  });

  test('unknown reason shows the chip only', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers');
    const row = page.getByTestId('server-row-r:c');
    await expect(row).toContainText('Busy');
    await expect(row).not.toContainText('coffee');
    await expect(row).not.toContainText('serversBoard.');
  });

  test('guessed addresses: one banner and an icon', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('servers-guessed-banner')).toHaveCount(1);
    await expect(page.getByTestId('server-row-guessed-r:b').filter({ visible: true })).toHaveCount(
      1
    );
    await expect(page.getByTestId('server-row-guessed-r:c')).toHaveCount(0);
  });

  test('a failed push shows a warning on the row', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-push-r:b')).toBeVisible();
    await expect(page.getByTestId('server-row-push-r:c')).toHaveCount(0);
  });

  test('the row menu holds the server actions', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers');
    await page.getByTestId('server-row-menu-r:b').click();
    await expect(page.getByTestId('fleet-rename-b')).toBeVisible();
    await expect(page.getByTestId('fleet-revoke-b')).toBeVisible();
  });

  test('a machine header shows its versions and opens the machine', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers');
    const machine = page.getByTestId('server-group-m1');
    await expect(machine).toContainText('csm 1.4.0');
    await expect(machine.getByTestId('machine-cs2-m1')).toBeVisible();
    await machine.getByTestId('machine-open-m1').click();
    await expect(page).toHaveURL(/[?&]machine=m1/);
  });

  test('a merged server opens one panel with Ready Up and its machine', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers');
    await page.getByTestId(MACHINE_ROW).click();
    const panel = page.getByTestId('server-panel');
    await expect(panel.getByTestId('server-panel-readyup')).toBeVisible();
    await expect(panel.getByTestId('server-panel-machine')).toBeVisible();
  });

  test('old fleetServer link opens the panel', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers?fleetServer=a');
    const panel = page.getByTestId('server-panel');
    await expect(panel.getByTestId('server-panel-machine')).toBeVisible();
    await expect(panel.getByTestId('server-panel-readyup')).toBeVisible();
    await expect(page).toHaveURL(/[?&]server=m%3Am1%3Aserver-1/);
  });

  test('the wizard shows only with no servers', async ({ page }) => {
    await stubMachines(page, []);
    await stubFleet(page, []);
    let servers: unknown[] = [];
    await page.route(
      (url) => url.pathname === '/api/servers',
      (route) => route.fulfill({ json: { success: true, servers } })
    );
    await page.goto('/manage/servers');
    await expect(page.getByText('Name the machine')).toBeVisible();
    servers = [
      {
        id: 'rc1',
        name: 'rcon-legacy',
        host: '10.0.0.9',
        port: 27015,
        enabled: true,
        transport: 'rcon',
      },
    ];
    await page.reload();
    await expect(page.getByTestId('server-row-x:rc1')).toBeVisible();
    await expect(page.getByText('Name the machine')).toHaveCount(0);
  });

  test('desktop rows are one line', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubAll(page);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-r:b')).toBeVisible();
    const heights = await page
      .locator('[role="listitem"][data-testid^="server-row-"]')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(heights.length).toBe(4);
    for (const h of heights) expect(h).toBeLessThanOrEqual(52);
  });

  test('columns line up across rows and groups', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubAll(page);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-x:rc1')).toBeVisible();
    const lefts = async (prefix: string) =>
      page
        .locator(`[data-testid^="${prefix}"]`)
        .evaluateAll((els) => [
          ...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))),
        ]);
    expect(await lefts('server-row-state-')).toHaveLength(1);
    expect(await lefts('server-row-address-')).toHaveLength(1);
    expect(await lefts('server-row-version-')).toHaveLength(1);
  });

  test('no summary pills: each row says its own state', async ({ page }) => {
    await stubAll(page);
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-x:rc1')).toBeVisible();
    await expect(page.getByTestId('machines-summary')).toHaveCount(0);
  });

  test('phone rows fit 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubAll(page, {
      b: { name: 'a-very-long-ready-up-server-name-that-goes-on-and-on-and-on' },
    });
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-r:b')).toBeVisible();
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll).toBeLessThanOrEqual(390);
    const heights = await page
      .locator('[role="listitem"][data-testid^="server-row-"]')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeLessThanOrEqual(72);
    // A free server has no reason: its second line is where players connect.
    await expect(
      page.getByTestId('server-row-r:b').getByText('203.0.113.5:27015').filter({ visible: true })
    ).toHaveCount(1);
    await page.getByTestId('server-row-menu-r:b').click();
    await expect(page.getByTestId('fleet-rename-b')).toBeVisible();
  });

  test('a linked machine row in a live match shows its phase, map and score', async ({ page }) => {
    await stubAll(page, { a: { availability: 'busy', availabilityReason: null } });
    await stubMatches(page, {
      'cs2-a': {
        slug: 'm-live',
        matchPhase: 'live',
        team1MapScore: 7,
        team2MapScore: 5,
        currentMap: 'de_inferno',
        mapNumber: 0,
        maps: ['de_inferno'],
      },
    });
    await page.goto('/manage/servers');
    const row = page.getByTestId(MACHINE_ROW);
    await expect(row.getByTestId('server-row-state-m:m1:server-1')).toContainText('Live');
    await expect(row).toContainText('Team A vs Team B · de_inferno 7 – 5');
  });

  test('a warmup row shows the map without a score', async ({ page }) => {
    await stubAll(page, { a: { availability: 'busy', availabilityReason: null } });
    await stubMatches(page, {
      'cs2-a': {
        slug: 'm-warm',
        matchPhase: 'warmup',
        currentMap: 'de_mirage',
        mapNumber: 0,
        maps: ['de_mirage'],
      },
    });
    await page.goto('/manage/servers');
    const row = page.getByTestId(MACHINE_ROW);
    await expect(row.getByTestId('server-row-state-m:m1:server-1')).toContainText('Warmup');
    await expect(row).toContainText('Team A vs Team B · de_mirage');
    await expect(row).not.toContainText('0 – 0');
  });

  test('a best-of-three row says which map and the series score', async ({ page }) => {
    await stubAll(page, { a: { availability: 'busy', availabilityReason: null } });
    await stubMatches(page, {
      'cs2-a': {
        slug: 'm-bo3',
        matchPhase: 'live',
        team1MapScore: 3,
        team2MapScore: 1,
        team1SeriesScore: 1,
        team2SeriesScore: 0,
        currentMap: 'de_nuke',
        mapNumber: 1,
        maps: ['de_inferno', 'de_nuke', 'de_ancient'],
      },
    });
    await page.goto('/manage/servers');
    await expect(page.getByTestId(MACHINE_ROW)).toContainText(
      'Team A vs Team B · de_nuke 3 – 1 · Map 2 of 3 (1 – 0)'
    );
  });

  test('a Ready Up row on no machine finds its match by the linked server', async ({ page }) => {
    await stubAll(page);
    await stubMatches(page, {
      'cs2-b': {
        slug: 'm-b',
        matchPhase: 'knife',
        currentMap: 'de_dust2',
        mapNumber: 0,
        maps: ['de_dust2'],
      },
    });
    await page.goto('/manage/servers');
    const row = page.getByTestId('server-row-r:b');
    await expect(row.getByTestId('server-row-state-r:b')).toContainText('Knife');
    await expect(row).toContainText('Team A vs Team B · de_dust2');
  });

  test('an RCON row in a match shows the line', async ({ page }) => {
    await stubAll(page);
    await stubMatches(page, {
      rc1: {
        slug: 'm-rc',
        matchPhase: 'live',
        team1MapScore: 2,
        team2MapScore: 0,
        currentMap: 'de_anubis',
        mapNumber: 0,
        maps: ['de_anubis'],
      },
    });
    await page.goto('/manage/servers');
    const row = page.getByTestId('server-row-x:rc1');
    await expect(row.getByTestId('server-row-state-x:rc1')).toContainText('Live');
    await expect(row).toContainText('Team A vs Team B · de_anubis 2 – 0');
  });

  test('the row menu opens the match', async ({ page }) => {
    await stubAll(page);
    await stubMatches(page, {
      'cs2-b': { slug: 'm-b', matchPhase: 'live', currentMap: 'de_dust2', maps: ['de_dust2'] },
    });
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-r:b')).toContainText('Team A vs Team B');
    await page.getByTestId('server-row-menu-r:b').click();
    await page.getByTestId('server-row-open-match-r:b').click();
    await expect(page.getByRole('dialog')).toContainText('Team A');
  });

  test('a row without a match has no open-match item', async ({ page }) => {
    await stubAll(page);
    await stubMatches(page, {
      'cs2-b': { slug: 'm-b', matchPhase: 'live', currentMap: 'de_dust2', maps: ['de_dust2'] },
    });
    await page.goto('/manage/servers');
    await expect(page.getByTestId('server-row-r:b')).toContainText('Team A vs Team B');
    await page.getByTestId('server-row-menu-r:c').click();
    await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toBeVisible();
    await expect(page.getByTestId('server-row-open-match-r:c')).toHaveCount(0);
  });

  test('a veto row says Veto and shows the teams only', async ({ page }) => {
    await stubAll(page, { a: { availability: 'busy', availabilityReason: null } });
    await stubMatches(page, {
      'cs2-a': {
        slug: 'm-veto',
        matchPhase: null,
        vetoing: true,
        vetoCompleted: false,
        currentMap: 'de_inferno',
        maps: ['de_inferno'],
      },
    });
    await page.goto('/manage/servers');
    const row = page.getByTestId(MACHINE_ROW);
    await expect(row.getByTestId('server-row-state-m:m1:server-1')).toContainText('Veto');
    await expect(row.getByText('Team A vs Team B', { exact: true })).toBeVisible();
    await expect(row).not.toContainText('de_inferno');
  });

  test('a stopped machine keeps its own state while availability lists a match', async ({
    page,
  }) => {
    await stubAll(page, { a: { availability: 'busy', availabilityReason: null } });
    await stubMachines(page, [
      machineHost('m1', [{ name: 'server-1', fleetId: 'a', process: { running: false } }]),
    ]);
    await stubMatches(page, { 'cs2-a': { slug: 'm-live', matchPhase: 'live' } });
    await page.goto('/manage/servers');
    const row = page.getByTestId(MACHINE_ROW);
    await expect(row.getByTestId('server-row-state-m:m1:server-1')).toContainText('Stopped');
    await expect(row).toContainText('Starts when a match needs it');
    await expect(row).not.toContainText('Team A vs Team B');
  });

  test('a slug on a free server does not make it a match row', async ({ page }) => {
    await stubAll(page, { a: { availability: 'available', availabilityReason: null } });
    await stubMatches(page, { 'cs2-a': { slug: 'm-old', matchPhase: 'live', allocatable: true } });
    await page.goto('/manage/servers');
    const row = page.getByTestId(MACHINE_ROW);
    await expect(row).toContainText('Free');
    await expect(row).not.toContainText('Team A vs Team B');
    await page.getByTestId('server-row-menu-m:m1:server-1').click();
    await expect(page.getByTestId('server-row-open-match-m:m1:server-1')).toHaveCount(0);
  });

  test('a completed match does not keep its server busy', async ({ page }) => {
    await stubAll(page, { a: { availability: 'available', availabilityReason: null } });
    await stubMatches(page, {
      'cs2-a': { slug: 'm-done', status: 'completed', matchPhase: 'live' },
    });
    await page.goto('/manage/servers');
    const row = page.getByTestId(MACHINE_ROW);
    await expect(row).toContainText('Free');
    await expect(row).not.toContainText('Team A vs Team B');
    await page.getByTestId('server-row-menu-m:m1:server-1').click();
    await expect(page.getByTestId('server-row-open-match-m:m1:server-1')).toHaveCount(0);
  });

  test('an offline Ready Up row shows its state, not its match', async ({ page }) => {
    await stubAll(page, { b: { online: false, lastSeen: Math.floor(Date.now() / 1000) - 600 } });
    await stubMatches(page, {
      'cs2-b': { slug: 'm-b', matchPhase: 'live', currentMap: 'de_dust2' },
    });
    await page.goto('/manage/servers');
    const row = page.getByTestId('server-row-r:b');
    await expect(row.getByTestId('server-row-state-r:b')).toContainText('Offline');
    await expect(row).toContainText('Seen');
    await expect(row).not.toContainText('Live');
  });

  test('a match still loading keeps the row reason', async ({ page }) => {
    await stubAll(page, { a: { availability: 'busy', availabilityReason: null } });
    await stubMachines(page, [
      machineHost('m1', [{ name: 'server-1', fleetId: 'a', process: { restarts_24h: 2 } }]),
    ]);
    await stubMatches(page, { 'cs2-a': { slug: 'm-live', matchPhase: 'live' } });
    await page.route(
      (url) => /^\/api\/matches\/[^/]+$/.test(url.pathname),
      (route) => route.fulfill({ status: 500, json: { success: false } })
    );
    await page.goto('/manage/servers');
    const row = page.getByTestId(MACHINE_ROW);
    await expect(row.getByTestId('server-row-state-m:m1:server-1')).toContainText('Match');
    await expect(row).toContainText('2 restarts in 24 h');
  });
});
