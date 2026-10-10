import type { Page } from '@playwright/test';

/** A Ready Up server as GET /api/fleet/servers lists it, for UI specs that stub the list. */
export const fleetServer = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  tenantId: 'default',
  name: `ru-${id}`,
  status: 'enrolled',
  installId: `inst-${id}`,
  enrolledVia: 'key',
  enrollmentKeyId: null,
  online: true,
  availability: 'available',
  availabilityReason: null,
  availabilityDetail: null,
  versions: { core: '0.1.0', plugin_api: '1.11', plugins: { fleet: '0.1.0' }, cs2_build: 14032 },
  readyUpUpdate: { state: 'current', running: '0.1.0', latest: '0.1.0', releaseUrl: null },
  capabilities: ['match.v1'],
  host: { hostname: id, game_port: 27015 },
  health: null,
  protocol: 1,
  connectedAt: 1,
  lastSeen: 1,
  createdAt: 1,
  token: null,
  rotateRequested: false,
  codeExpiresAt: null,
  linkedServerId: `cs2-${id}`,
  connect: null,
  ...over,
});

export async function stubFleet(page: Page, servers: unknown[]) {
  await page.route(
    (url) => url.pathname === '/api/fleet/servers',
    (route) => route.fulfill({ json: { success: true, count: servers.length, servers } })
  );
  await page.route(
    (url) => url.pathname === '/api/fleet/keys',
    (route) => route.fulfill({ json: { success: true, keys: [] } })
  );
}

/** GET /api/fleet/servers/:id for each stubbed server (404 for others), with its players. */
export async function stubFleetDetail(
  page: Page,
  servers: Array<Record<string, unknown> & { id: string }>
) {
  await page.route(
    (url) => /^\/api\/fleet\/servers\/[^/]+$/.test(url.pathname),
    (route) => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
      const server = servers.find((s) => s.id === id);
      if (!server)
        return route.fulfill({
          status: 404,
          json: { success: false, error: 'Fleet server not found' },
        });
      return route.fulfill({ json: { success: true, server: { players: [], ...server } } });
    }
  );
}

/** A linked csm machine as GET /api/fleet/hosts lists it; `servers` link to Ready Up ids when given. */
export const machineHost = (
  id: string,
  servers: Array<{ name: string; fleetId?: string }>,
  over: Record<string, unknown> = {}
) => ({
  id,
  name: `machine-${id}`,
  status: 'enrolled',
  machineId: null,
  enrolledVia: 'code',
  hostname: `${id}.lan`,
  os: 'linux',
  csmVersion: '1.4.0',
  online: true,
  connectedAt: 1,
  lastSeen: 1,
  createdAt: 1,
  inventory: {
    resources: { cpus: 8, load1: 0.2, ram_mb: 16000, ram_free_mb: 8000, disk: [] },
    cs2: { master_build: 14032, update_available: false, updates_hold: 'auto' },
  },
  inventoryAt: 1,
  token: null,
  rotateRequested: false,
  codeExpiresAt: null,
  servers: servers.map((s, i) => ({
    name: s.name,
    dir: `/srv/${s.name}`,
    game_port: 27015 + i,
    status_port: 28015 + i,
    process: { running: true, restarts_24h: 0 },
    readyup: { installed: s.fleetId ? '0.4.0' : null, health: s.fleetId ? 'ok' : 'not_running' },
    cs2_build: 14032,
    launch_args: [],
    fleetServer: s.fleetId
      ? {
          id: s.fleetId,
          name: `ru-${s.fleetId}`,
          status: 'enrolled',
          online: true,
          availability: 'available',
          readyUpVersion: '0.4.0',
        }
      : null,
    matchInProgress: false,
  })),
  enrolledServers: [],
  autoUpdate: null,
  commands: [],
  health: [],
  ...over,
});

/** GET /api/fleet/hosts with these machines. */
export async function stubMachines(page: Page, hosts: unknown[]) {
  await page.route(
    (url) => url.pathname === '/api/fleet/hosts',
    (route) => route.fulfill({ json: { success: true, count: hosts.length, hosts } })
  );
}
