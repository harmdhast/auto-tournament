/**
 * Which `cs2_servers` row a Ready Up fleet server plays matches as.
 *
 * Matches point at `cs2_servers` (`matches.server_id`), and so do the
 * allocator, the admin buttons and the match pages. A fleet server
 * (`cs2_fleet_servers`, enrolled over `/api/fleet/enroll`) takes matches once
 * an admin links it to a row: `transport = 'fleet'` and `fleet_server_id` on
 * that row (migration 006). Linking is explicit (`POST
 * /api/fleet/servers/:id/link`), so enrolling a server never puts it in the
 * match pool by itself.
 *
 * - Link to a new row (the default): its id is the fleet server's id, its
 *   address where players connect (./address.ts: the server's
 *   `public_addr`, else the link's peer address; never the machine's
 *   hostname), and it has no RCON password. Each hello refreshes that
 *   address (`syncLinkedAddress`).
 * - Link to an existing row (`serverId`): an RCON server that was moved to
 *   Ready Up keeps its id, so history and match links stay, and its host /
 *   port, which an admin entered (`host_override`).
 * - `host` / `port` on the link (or `setLinkAddress` later) are an admin
 *   override: stored with `host_override = 1`, never replaced by a hello.
 *   `setLinkAddress(id, null)` goes back to the detected address.
 * - A new row starts with skins on when the server's enrollment key says so
 *   (`skins`) and is neither revoked nor expired; a row taken over from an
 *   earlier link keeps what an admin set.
 * - Unlink: the row goes back to `transport = 'rcon'` and is disabled when it
 *   was created by the link (it has no RCON password to be driven with).
 */

import { db } from '../../../config/database';
import { serverService } from '../services/serverService';
import { log } from '../../../utils/logger';
import {
  chooseConnectAddress,
  DEFAULT_GAME_PORT,
  isValidConnectHost,
  type ConnectAddress,
} from './address';
import type { HostInfo } from './protocol/v1';
import { getFleetServer, type FleetServerRow } from './registry';
import { fleetServerJoinRows } from './hosts/registry';
import { claimableIndex, joinInventory } from './hosts/join';
import type { HostInventoryServer } from './protocol/host/v1';
import { createdPluginSet, matchPluginDisabled } from './push/pluginSets';

export interface FleetLink {
  /** cs2_servers.id (matches.server_id). */
  cs2ServerId: string;
  /** cs2_fleet_servers.id. */
  fleetServerId: string;
}

interface LinkRow {
  id: string;
  fleet_server_id: string | null;
  transport: string | null;
  host?: string;
  port?: number;
  host_override?: number | null;
}

/** Where players connect to a linked fleet server (the cs2_servers row's host / port). */
export interface LinkAddress {
  cs2ServerId: string;
  host: string;
  port: number;
  /** An admin set it; hellos leave it alone. */
  override: boolean;
}

/** An admin's connect address: host name or IP, optional port (default: the server's game port). */
export interface AddressOverride {
  host: string;
  port?: number;
}

/** The fleet server behind a cs2_servers row, or null for an RCON server. */
export async function fleetServerIdOf(cs2ServerId: string): Promise<string | null> {
  const row = await db.queryOneAsync<LinkRow>(
    'SELECT id, fleet_server_id, transport FROM cs2_servers WHERE id = ?',
    [cs2ServerId]
  );
  return row && row.transport === 'fleet' && row.fleet_server_id ? row.fleet_server_id : null;
}

/** The cs2_servers row a fleet server plays as, or null when it is not linked. */
export async function cs2ServerIdOf(fleetServerId: string): Promise<string | null> {
  const row = await db.queryOneAsync<LinkRow>(
    `SELECT id, fleet_server_id, transport FROM cs2_servers WHERE fleet_server_id = ? AND transport = 'fleet'`,
    [fleetServerId]
  );
  return row?.id ?? null;
}

/** Every link with its connect address, keyed by fleet server id. */
export async function listLinkAddresses(): Promise<Map<string, LinkAddress>> {
  const rows = await db.queryAsync<LinkRow>(
    `SELECT id, fleet_server_id, transport, host, port, host_override FROM cs2_servers
      WHERE transport = 'fleet' AND fleet_server_id IS NOT NULL`
  );
  return new Map(
    rows.map((r) => [
      r.fleet_server_id as string,
      {
        cs2ServerId: r.id,
        host: r.host ?? '',
        port: Number(r.port),
        override: Number(r.host_override ?? 0) === 1,
      },
    ])
  );
}

/** Where a fleet server's players would connect if it were linked now (null = nothing usable yet). */
export function detectedAddress(
  fleet: Pick<FleetServerRow, 'host' | 'peer_addr'>,
  machineAddr?: string | null
): ConnectAddress | null {
  return chooseConnectAddress(parseHost(fleet.host), fleet.peer_addr ?? null, machineAddr);
}

/**
 * An address per csm machine, for the servers each machine may claim
 * (./hosts/join.ts claimableIndex), keyed by fleet server id and by
 * `install:<install id>`. A server another machine's inventory also names, or
 * one enrolled with another machine's key, gets none from this one.
 */
async function claimedAddresses(
  addressOf: (row: { inventory: { address?: unknown }; publicAddress: string | null }) => unknown
): Promise<Map<string, string>> {
  const hosts = await db.queryAsync<{
    id: string;
    inventory: string | null;
    public_address: string | null;
  }>(
    `SELECT id, inventory, public_address FROM cs2_fleet_hosts WHERE status = 'enrolled' AND inventory IS NOT NULL`
  );
  const inventories = hosts.map((h) => {
    let inv: { address?: unknown; servers?: Array<Pick<HostInventoryServer, 'readyup'>> } = {};
    try {
      inv = JSON.parse(h.inventory as string);
    } catch {
      // An inventory that does not parse names no server.
    }
    return {
      id: h.id,
      address: addressOf({ inventory: inv, publicAddress: h.public_address }),
      servers: (inv.servers ?? []).filter((s) => s?.readyup),
    };
  });
  const rows = await fleetServerJoinRows();
  const out = new Map<string, string>();
  for (const inv of inventories) {
    if (typeof inv.address !== 'string' || !inv.address) continue;
    const others = inventories.filter((o) => o.id !== inv.id).map((o) => o.servers);
    const index = claimableIndex(inv.id, rows, others);
    for (const s of joinInventory(inv.servers as HostInventoryServer[], index, () => false)) {
      if (!s.fleetServer) continue;
      out.set(s.fleetServer.id, inv.address);
      const installId = index.byId.get(s.fleetServer.id)?.install_id;
      if (installId) out.set(`install:${installId}`, inv.address);
    }
  }
  return out;
}

/** The address each machine reports (`host.inventory.address`, csm 1.21+), per claimed server. */
export async function machineAddresses(): Promise<Map<string, string>> {
  return claimedAddresses(({ inventory }) => inventory.address);
}

/**
 * The admin's public address of the machine each fleet server runs on (Servers page,
 * cs2_fleet_hosts.public_address), keyed like `machineAddresses`. It wins over every
 * reported address: csm and Ready Up report the machine's LAN address, which players
 * outside its network cannot reach.
 */
export async function machinePublicAddresses(): Promise<Map<string, string>> {
  return claimedAddresses(({ publicAddress }) => (publicAddress ?? '').trim());
}

/** One fleet server's machine address from `machineAddresses()`, or null. */
export function machineAddressOf(
  addresses: Map<string, string>,
  fleet: { id: string; install_id?: string | null }
): string | null {
  return (
    addresses.get(fleet.id) ??
    (fleet.install_id ? addresses.get(`install:${fleet.install_id}`) : undefined) ??
    null
  );
}

function blank(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

/** Validate an admin's override (both blank = none); the error text is for the API response. */
export function checkAddressOverride(value: {
  host?: unknown;
  port?: unknown;
}): { ok: true; override: AddressOverride | null } | { ok: false; error: string } {
  if (blank(value.host) && blank(value.port)) return { ok: true, override: null };
  if (typeof value.host !== 'string' || !isValidConnectHost(value.host.trim())) {
    return { ok: false, error: 'host must be a host name or IP address (no port, scheme or path)' };
  }
  let port: number | undefined;
  if (!blank(value.port)) {
    port = Number(value.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return { ok: false, error: 'port must be 1-65535' };
  }
  return { ok: true, override: { host: value.host.trim(), ...(port ? { port } : {}) } };
}

function parseHost(raw: string | null): HostInfo | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HostInfo;
  } catch {
    return null;
  }
}

export type LinkOutcome =
  { ok: true; link: FleetLink; created: boolean } | { ok: false; status: 404 | 409; error: string };

/**
 * Link an enrolled fleet server to `serverId` (an existing cs2_servers row),
 * or to a new row named after it.
 */
export async function linkFleetServer(
  fleetServerId: string,
  options: { serverId?: string; name?: string; address?: AddressOverride } = {}
): Promise<LinkOutcome> {
  const fleet = await getFleetServer(fleetServerId);
  if (!fleet) return { ok: false, status: 404, error: 'Fleet server not found' };
  if (fleet.status !== 'enrolled') {
    return { ok: false, status: 409, error: 'Only an enrolled fleet server can take matches' };
  }
  const existing = await cs2ServerIdOf(fleetServerId);
  if (existing && (!options.serverId || options.serverId === existing)) {
    if (options.address) await setLinkAddress(fleetServerId, options.address);
    return { ok: true, link: { cs2ServerId: existing, fleetServerId }, created: false };
  }
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: `Fleet server is already linked to server ${existing}; unlink it first`,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (options.serverId) {
    const row = await db.queryOneAsync<LinkRow>(
      'SELECT id, fleet_server_id, transport FROM cs2_servers WHERE id = ?',
      [options.serverId]
    );
    if (!row) return { ok: false, status: 404, error: `Server ${options.serverId} not found` };
    if (row.fleet_server_id && row.fleet_server_id !== fleetServerId) {
      return {
        ok: false,
        status: 409,
        error: `Server ${options.serverId} is linked to another fleet server`,
      };
    }
    // Its host / port were entered by an admin for RCON: keep them unless
    // this link sets new ones.
    await db.runAsync(
      `UPDATE cs2_servers SET transport = 'fleet', fleet_server_id = ?, host_override = 1, updated_at = ? WHERE id = ?`,
      [fleetServerId, now, options.serverId]
    );
    if (options.address) await setLinkAddress(fleetServerId, options.address);
    return { ok: true, link: { cs2ServerId: options.serverId, fleetServerId }, created: false };
  }

  const gamePort = parseHost(fleet.host)?.game_port ?? DEFAULT_GAME_PORT;
  const detected = detectedAddress(fleet, machineAddressOf(await machineAddresses(), fleet));
  const override = options.address ?? null;
  // Nothing detected yet (never connected, enrolled before peer addresses
  // were kept): an address that is at least not the machine's name; the next
  // hello replaces it.
  const address = override?.host ?? detected?.host ?? '0.0.0.0';
  const port = override ? (override.port ?? gamePort) : (detected?.port ?? gamePort);
  const hostOverride = override ? 1 : 0;
  const taken = await db.queryOneAsync<{ id: string }>('SELECT id FROM cs2_servers WHERE id = ?', [
    fleetServerId,
  ]);
  if (taken) {
    // A row left from an earlier link: take it over.
    await db.runAsync(
      `UPDATE cs2_servers SET transport = 'fleet', fleet_server_id = ?, host = ?, port = ?, host_override = ?, enabled = 1, updated_at = ? WHERE id = ?`,
      [fleetServerId, address, port, hostOverride, now, fleetServerId]
    );
  } else {
    // Skins start as the server's enrollment key says (off without a live key).
    await db.runAsync(
      `INSERT INTO cs2_servers (id, name, host, port, password, enabled, transport, fleet_server_id, status, host_override, skins)
       VALUES (?, ?, ?, ?, '', 1, 'fleet', ?, 'unknown', ?,
               COALESCE((SELECT k.skins FROM cs2_fleet_enrollment_keys k
                         WHERE k.id = ? AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > ?)), 0))`,
      [
        fleetServerId,
        (options.name ?? fleet.name).slice(0, 100),
        address,
        port,
        fleetServerId,
        hostOverride,
        fleet.enrollment_key_id,
        now,
      ]
    );
  }
  return { ok: true, link: { cs2ServerId: fleetServerId, fleetServerId }, created: !taken };
}

/**
 * A server csm created (an admin's Create server, not only the scaler's or a
 * failover's) joins the match pool on its first hello, unless its plugin set
 * turns match off (a practice server). Once: a cs2_servers row for it means
 * it was linked before, and an admin's unlink sets auto_linked_at, so it sticks.
 */
async function linkCreatedOnce(serverId: string): Promise<void> {
  // The scaler and failover link what they create themselves (with their own records).
  const cmd = await db.queryOneAsync<{ issued_by: string | null; type: string }>(
    `SELECT c.issued_by, c.type FROM cs2_fleet_servers s
       JOIN cs2_fleet_enrollment_keys k ON k.id = s.enrollment_key_id
       JOIN cs2_fleet_host_commands c ON c.message_id = k.command_id
      WHERE s.id = ? AND c.type IN ('server.create', 'server.enroll')`,
    [serverId]
  );
  if (!cmd) return;
  // A machine's own servers enrolled again (server.enroll, a machine linked
  // again): they were match servers before, so they are again.
  if (cmd.type === 'server.create') {
    if (cmd.issued_by === 'autoscale' || (cmd.issued_by ?? '').startsWith('platform:')) return;
    const created = await createdPluginSet(serverId);
    if (!created.created) return;
    if (created.set && !created.set.plugins.includes('match')) return;
  } else if (await matchPluginDisabled(serverId)) {
    // Enrolled again with match off (it was a practice or tryout server): not a match server.
    return;
  }
  const seen = await db.queryOneAsync<{ id: string }>(
    `SELECT id FROM cs2_servers WHERE id = ? OR fleet_server_id = ?
     UNION ALL
     SELECT id FROM cs2_fleet_servers WHERE id = ? AND auto_linked_at IS NOT NULL`,
    [serverId, serverId, serverId]
  );
  if (seen) return;
  const outcome = await linkFleetServer(serverId);
  const how = cmd.type === 'server.enroll' ? 'enrolled again through csm' : 'created through csm';
  if (outcome.ok) log.info(`[FLEET] ${serverId}: ${how}; joined the match pool`);
  else log.warn(`[FLEET] ${serverId}: ${how} but not linked: ${outcome.error}`);
}

/**
 * A server enrolled with a fleet key set to auto-link joins the match pool on
 * its first hello, unless the key was revoked or expired since. Once:
 * cs2_fleet_servers.auto_linked_at is set when the link succeeds, so an
 * admin's unlink or deleting the server sticks.
 */
async function linkKeyEnrolledOnce(serverId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const key = await db.queryOneAsync<{ id: string }>(
    `SELECT k.id FROM cs2_fleet_servers s
       JOIN cs2_fleet_enrollment_keys k ON k.id = s.enrollment_key_id
      WHERE s.id = ? AND s.auto_linked_at IS NULL AND k.auto_link = 1
        AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > ?)`,
    [serverId, now]
  );
  if (!key) return;
  const outcome = await linkFleetServer(serverId);
  if (!outcome.ok) {
    log.warn(
      `[FLEET] ${serverId}: enrolled with auto-link key ${key.id} but not linked: ${outcome.error}`
    );
    return;
  }
  await db.runAsync('UPDATE cs2_fleet_servers SET auto_linked_at = ? WHERE id = ?', [
    now,
    serverId,
  ]);
  log.info(`[FLEET] ${serverId}: enrolled with auto-link key ${key.id}; joined the match pool`);
}

/** First hello of an enrolled server: joins the match pool when its origin says so. */
export async function autoLinkOnEnroll(serverId: string): Promise<void> {
  await linkCreatedOnce(serverId);
  await linkKeyEnrolledOnce(serverId);
}

/**
 * Undo a link: the server's row goes. `auto_linked_at` is set so the first-hello
 * links (autoLinkOnEnroll) do not link it again. Returns the row that was
 * linked, or null when there was none.
 */
export async function unlinkFleetServer(fleetServerId: string): Promise<string | null> {
  const cs2ServerId = await cs2ServerIdOf(fleetServerId);
  if (!cs2ServerId) return null;
  await serverService.deleteServer(cs2ServerId);
  await db.runAsync(
    'UPDATE cs2_fleet_servers SET auto_linked_at = COALESCE(auto_linked_at, ?) WHERE id = ?',
    [Math.floor(Date.now() / 1000), fleetServerId]
  );
  return cs2ServerId;
}

/**
 * Set (or with null, clear) the admin's connect address of a linked server.
 * Clearing goes back to the detected address right away when there is one.
 * Returns the address now stored, or null when the server is not linked.
 */
export async function setLinkAddress(
  fleetServerId: string,
  override: AddressOverride | null
): Promise<LinkAddress | null> {
  const cs2ServerId = await cs2ServerIdOf(fleetServerId);
  if (!cs2ServerId) return null;
  const now = Math.floor(Date.now() / 1000);
  if (override) {
    const fleet = await getFleetServer(fleetServerId);
    const port = override.port ?? parseHost(fleet?.host ?? null)?.game_port ?? DEFAULT_GAME_PORT;
    await db.runAsync(
      `UPDATE cs2_servers SET host = ?, port = ?, host_override = 1, updated_at = ? WHERE id = ?`,
      [override.host, port, now, cs2ServerId]
    );
  } else {
    await db.runAsync(`UPDATE cs2_servers SET host_override = 0, updated_at = ? WHERE id = ?`, [
      now,
      cs2ServerId,
    ]);
    await syncLinkedAddress(fleetServerId);
  }
  return (await listLinkAddresses()).get(fleetServerId) ?? null;
}

/**
 * After a hello: move the linked row to the address the server reports now
 * (unless an admin set it). Returns the new address when it changed.
 */
export async function syncLinkedAddress(fleetServerId: string): Promise<ConnectAddress | null> {
  const row = await db.queryOneAsync<LinkRow>(
    `SELECT id, fleet_server_id, transport, host, port, host_override FROM cs2_servers
      WHERE fleet_server_id = ? AND transport = 'fleet'`,
    [fleetServerId]
  );
  if (!row || Number(row.host_override ?? 0) === 1) return null;
  const fleet = await getFleetServer(fleetServerId);
  if (!fleet) return null;
  const detected = detectedAddress(fleet, machineAddressOf(await machineAddresses(), fleet));
  const publicHost = machineAddressOf(await machinePublicAddresses(), fleet);
  const next: ConnectAddress | null = publicHost
    ? {
        host: publicHost,
        port: detected?.port ?? parseHost(fleet.host)?.game_port ?? DEFAULT_GAME_PORT,
        source: 'machine_public',
      }
    : detected;
  if (!next || (next.host === row.host && next.port === Number(row.port))) return null;
  await db.runAsync(`UPDATE cs2_servers SET host = ?, port = ?, updated_at = ? WHERE id = ?`, [
    next.host,
    next.port,
    Math.floor(Date.now() / 1000),
    row.id,
  ]);
  log.info(
    `[FLEET] ${fleetServerId}: connect address ${row.host}:${row.port} -> ${next.host}:${next.port} (${next.source})`
  );
  return next;
}

/**
 * A fleet server was renamed: the row it plays matches as took the name at
 * link time, so give it the new one too (matches and the server list show
 * that row's name). No-op when the server is not linked.
 */
export async function renameLinkedRow(fleetServerId: string, name: string): Promise<void> {
  const cs2ServerId = await cs2ServerIdOf(fleetServerId);
  if (!cs2ServerId) return;
  await db.runAsync('UPDATE cs2_servers SET name = ?, updated_at = ? WHERE id = ?', [
    name.slice(0, 100),
    Math.floor(Date.now() / 1000),
    cs2ServerId,
  ]);
}
