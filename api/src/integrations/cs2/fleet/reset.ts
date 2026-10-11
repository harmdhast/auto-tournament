import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import {
  findActiveMatchForServer,
  settleActiveMatchOn,
} from '../../../services/matchTerminationService';
import {
  auditedFleetCommand,
  isUnsupportedAnswer,
  openAssignmentOn,
  unassignAll,
  type IssuedBy,
} from './driver';
import { cs2ServerIdOf } from './link';
import * as registry from './registry';
import { fleetBus } from './service';

/**
 * Reset a Ready Up server (cmd reset, FLEET.md §7.4): whatever it holds goes —
 * the platform's assignment, a match loaded on the server itself, one startup
 * recovery would restore — and the match the platform had there is settled the
 * way End match settles it. The command goes first: an older Ready Up that does
 * not know it leaves everything as it was.
 */
export type ResetOutcome =
  | { ok: true; ended: 'local' | 'assignment' | 'none'; settledMatchSlug: string | null }
  | { ok: false; httpStatus: number; errorCode: string | null; error: string };

const RESET_EXPIRES_MS = 15_000;
/** Servers being reset right now (this process): a second press waits for the first. */
const resetting = new Set<string>();

export async function resetFleetServer(
  fleetServerId: string,
  who: IssuedBy & { actor: string | null }
): Promise<ResetOutcome> {
  const server = await registry.getFleetServer(fleetServerId);
  if (!server)
    return { ok: false, httpStatus: 404, errorCode: 'not_found', error: 'Fleet server not found' };
  if (!fleetBus().isConnected(fleetServerId)) {
    return {
      ok: false,
      httpStatus: 409,
      errorCode: 'offline',
      error: 'The Ready Up server is offline',
    };
  }
  if (resetting.has(fleetServerId)) {
    return {
      ok: false,
      httpStatus: 409,
      errorCode: 'busy',
      error: 'This server is already being reset',
    };
  }
  resetting.add(fleetServerId); // before any await: a second press is refused above
  const cs2ServerId = await cs2ServerIdOf(fleetServerId);
  const { cs2ServerPool } = await import('../allocation');
  const { serverAllocationTracker } = await import('../services/serverAllocationTracker');
  if (cs2ServerId && cs2ServerPool.isAllocating(cs2ServerId)) {
    resetting.delete(fleetServerId);
    return {
      ok: false,
      httpStatus: 409,
      errorCode: 'busy',
      error: 'A match is being loaded on this server',
    };
  }
  // The allocator leaves it alone until the reset is over (it is offered again once Ready Up
  // says it is available).
  if (cs2ServerId) serverAllocationTracker.markPreparing(cs2ServerId, null);
  try {
    const assignment = await openAssignmentOn(fleetServerId);
    const match = cs2ServerId ? await findActiveMatchForServer(cs2ServerId) : null;
    const stored = await db.queryOneAsync<{ availability_reason: string | null }>(
      'SELECT availability_reason FROM cs2_fleet_servers WHERE id = ?',
      [fleetServerId]
    );

    const outcome = await auditedFleetCommand(fleetServerId, 'reset', {}, 'reset', who, {
      expiresMs: RESET_EXPIRES_MS,
    });
    if (isUnsupportedAnswer(outcome)) {
      return {
        ok: false,
        httpStatus: 409,
        errorCode: 'unsupported',
        error: 'This Ready Up does not know reset yet: update it',
      };
    }
    if (!outcome.ok) {
      return {
        ok: false,
        httpStatus: outcome.httpStatus,
        errorCode: outcome.errorCode,
        error: outcome.error ?? 'Reset failed',
      };
    }

    let settledMatchSlug: string | null = null;
    if (cs2ServerId) {
      // Whatever runs there now, not only what was seen before the command.
      settledMatchSlug = await settleActiveMatchOn(cs2ServerId, 'server reset');
      await unassignAll(cs2ServerId, 'admin');
    }
    const said = outcome.data?.ended;
    const ended: 'local' | 'assignment' | 'none' =
      assignment || match
        ? 'assignment'
        : said === 'local' || said === 'assignment' || said === 'none'
          ? said
          : stored?.availability_reason === 'local_match' ||
              stored?.availability_reason === 'awaiting_reset'
            ? 'local'
            : 'none';
    log.info(`[FLEET] ${fleetServerId}: reset by ${who.actor ?? 'unknown'} (ended ${ended})`);
    return { ok: true, ended, settledMatchSlug };
  } finally {
    resetting.delete(fleetServerId);
    if (cs2ServerId) serverAllocationTracker.markIdle(cs2ServerId);
  }
}
