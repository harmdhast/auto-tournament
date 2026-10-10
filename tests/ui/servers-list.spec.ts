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
});
