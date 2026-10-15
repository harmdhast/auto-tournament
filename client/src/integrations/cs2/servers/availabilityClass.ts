/** How the allocator's view of a server reads: its bucket on the admin home, its place on the Manage grid. */
import type { ServerAllocationInfo, ServerAvailability, ServerFleetCounts } from '../cs2.types';

export type AvailabilityClass = 'free' | 'inMatch' | 'busy' | 'draining' | 'spare' | 'offline';

/** Which bucket one server counts in. A server with no reason and no slot is read as in a match. */
export function classifyAllocation(server: ServerAllocationInfo): AvailabilityClass {
  if (!server.online) return 'offline';
  if (server.allocatable) return 'free';
  if (server.busyReason === 'reserved' || server.notAllocatableReason === 'reserved')
    return 'spare';
  if (server.matchSlug) return 'inMatch';
  if (server.busyReason === 'draining') return 'draining';
  if (!server.busyReason) return 'inMatch';
  return 'busy';
}

/** Online / in-match / free / offline from the allocator's view of the fleet. */
export function countFleet(availability: ServerAvailability): ServerFleetCounts {
  const counts: ServerFleetCounts = {
    online: 0,
    inMatch: 0,
    busy: 0,
    draining: 0,
    spare: 0,
    free: 0,
    offline: 0,
    total: 0,
  };
  for (const server of availability.servers ?? []) {
    counts.total += 1;
    const bucket = classifyAllocation(server);
    counts[bucket] += 1;
    if (bucket !== 'offline') counts.online += 1;
  }
  return counts;
}

/** The line that says why a Ready Up server takes no match (api fleet/busyReason.ts). */
export const BUSY_REASON_KEY: Record<string, string> = {
  local_match: 'managePage.servers.busyReason.localMatch',
  awaiting_reset: 'managePage.servers.busyReason.awaitingReset',
  match_disabled: 'managePage.servers.busyReason.matchDisabled',
  draining: 'managePage.servers.busyReason.draining',
  reserved: 'managePage.servers.busyReason.reserved',
};

const PHASE_RANK: Record<string, number> = { live: 0, knife: 1, warmup: 2, veto: 3 };
const OTHER_PHASE_RANK = 4;
const FREE_RANK = 10;
const RESTING_RANK = 11;
const BUSY_RANK = 12;
const CHECKING_RANK = 13;
const OFFLINE_RANK = 14;

/**
 * Where a tile goes on the dashboard, lowest first: servers in a match (live,
 * knife, warmup, veto, then the rest), free ones, resting or spare ones, busy
 * ones, ones still being checked, offline ones. Not configured servers follow.
 */
export function serverRank(
  server: ServerAllocationInfo,
  match: { phase: string | null } | undefined,
  checking: boolean
): number {
  if (!server.online) return checking && !server.updatedAt ? CHECKING_RANK : OFFLINE_RANK;
  if (match) return PHASE_RANK[match.phase ?? ''] ?? OTHER_PHASE_RANK;
  if (server.allocatable) return FREE_RANK;
  if (
    server.notAllocatableReason === 'grace-window' ||
    server.busyReason === 'reserved' ||
    server.busyReason === 'draining'
  )
    return RESTING_RANK;
  return BUSY_RANK;
}
