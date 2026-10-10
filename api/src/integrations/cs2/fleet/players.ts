import type { StateSnapshotPayload } from './protocol/v1/types';
import { fleetBus } from './service';

/** A human on a Ready Up server, from its latest state.snapshot `players` (assigned or not). */
export interface FleetPlayer {
  steamid64: string;
  name: string;
  team: 'none' | 'spectator' | 't' | 'ct';
}

const latest = new Map<string, FleetPlayer[]>();

/**
 * Keep the players a snapshot reports. One without `players` (built by fleet.so itself:
 * a state.request answer, a reconnect; or an older Ready Up) leaves the list as it was.
 */
export function noteSnapshot(fleetServerId: string, payload: StateSnapshotPayload): void {
  if (Array.isArray(payload.players)) latest.set(fleetServerId, payload.players.slice(0, 64));
}

/** Who is on the server now: nobody when it is offline or never said. */
export function fleetPlayersOf(fleetServerId: string): FleetPlayer[] {
  if (!fleetBus().isConnected(fleetServerId)) return [];
  return latest.get(fleetServerId) ?? [];
}
