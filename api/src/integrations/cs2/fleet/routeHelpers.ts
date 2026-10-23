/** What the fleet admin routes share (./routes.ts). */

import type { Untrusted } from '../../../utils/untrusted';
import type { Request, Response } from 'express';
import { log } from '../../../utils/logger';
import type * as registry from './registry';
import { fleetBus } from './service';
import { detectedAddress, machineAddressOf, machineAddresses, listLinkAddresses } from './link';
import { formatConnectAddress, type ConnectSource } from './address';
import { effectiveBusyReason } from './busyReason';
import type { BusyReason } from './protocol/v1/types';
import { heldFleetSpares } from './failover';
import { matchDisabledServerIds } from './push/pluginSets';

/** An admin handler whose failure is a JSON 500 rather than a hung request. */
export function handler(
  what: string,
  fn: (req: Request, res: Response) => Promise<void | Response>
) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((error) => {
      log.error(`[FLEET] ${what} failed: ${(error as Error).message}`);
      if (!res.headersSent) res.status(500).json({ success: false, error: `Failed to ${what}` });
    });
  };
}

export function withLiveState(servers: registry.FleetServerView[]): registry.FleetServerView[] {
  // The socket map is the truth for "online" in this process; the column can
  // lag a crash by one restart.
  const bus = fleetBus();
  return servers.map((s) => ({ ...s, online: bus.isConnected(s.id) }));
}

interface ConnectView {
  host: string;
  port: number;
  /** `host:port` as players type it after `connect`. */
  address: string;
  /** override: an admin set it; public_addr / machine / peer: detected (./address.ts); null: nothing yet. */
  source: ConnectSource | null;
}

function connectSource(
  link: { host: string; port: number; override?: boolean },
  detected: ReturnType<typeof detectedAddress>
): ConnectSource | null {
  if (link.override) return 'override';
  if (detected?.host === link.host && detected.port === link.port) return detected.source;
  return null;
}

/**
 * `linkedServerId`: the cs2_servers row it plays matches as (null = not in
 * the match pool). `connect`: where players connect: the linked row's address,
 * or for an unlinked server the one a link would store now.
 */
export async function withLinks<
  T extends {
    id: string;
    installId?: string | null;
    host: { public_addr?: string; game_port: number } | null;
    peerAddr: string | null;
  },
>(
  servers: T[]
): Promise<Array<T & { linkedServerId: string | null; connect: ConnectView | null }>> {
  const links = await listLinkAddresses();
  const machines = await machineAddresses();
  return servers.map((s) => {
    const link = links.get(s.id);
    const detected = detectedAddress(
      { host: s.host ? JSON.stringify(s.host) : null, peer_addr: s.peerAddr },
      machineAddressOf(machines, { id: s.id, install_id: s.installId ?? null })
    );
    let connect: ConnectView | null = null;
    if (link?.host && link.host !== '0.0.0.0') {
      connect = {
        host: link.host,
        port: link.port,
        address: formatConnectAddress(link.host, link.port),
        source: connectSource(link, detected),
      };
    } else if (!link && detected) {
      connect = { ...detected, address: formatConnectAddress(detected.host, detected.port) };
    }
    return { ...s, linkedServerId: link?.cs2ServerId ?? null, connect };
  });
}

export function trimmedString(value: Untrusted, max: number): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length === 0 || t.length > max ? null : t;
}

export function optionalPositiveInt(value: Untrusted): number | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The reason to show for a server: match off and failover spares come from the platform. */
export async function busyReasonResolver(): Promise<
  (id: string, stored: BusyReason | null) => BusyReason | null
> {
  const [matchOff, spares] = await Promise.all([matchDisabledServerIds(), heldFleetSpares()]);
  const spareIds = new Set(spares.map((c) => c.fleetServerId));
  return (id, stored) =>
    effectiveBusyReason(stored, { matchDisabled: matchOff.has(id), reserved: spareIds.has(id) });
}
