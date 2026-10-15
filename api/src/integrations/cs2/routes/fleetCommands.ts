/**
 * The admin server buttons (`/api/rcon/*`, ./rcon.ts) on a Ready Up server:
 * the same routes, sent as a fleet `cmd` (FLEET.md §7.4) instead of an RCON
 * command, answered with the server's `cmd.result`.
 *
 * The response keeps the RCON shape (`success`, `response`, `error`) so the
 * admin UI reads both the same way, plus `transport: 'fleet'`, the result
 * `status` / `errorCode` and the command id.
 */

import type { Request, Response } from 'express';
import { requestActorId } from '../../../middleware/auth';
import { isRootRequest } from '../../../utils/rootAccess';
import { transportOf } from '../driver';
import {
  execOnFleetServer,
  runFleetCommand,
  type FleetCommandOutcome,
  type IssuedBy,
} from '../fleet/driver';
import type { CmdName } from '../fleet/protocol/v1';
import type { ServerTransport } from '../../../types/server.types';

export type MatchControlId =
  | 'pause'
  | 'unpause'
  | 'swap'
  | 'restartRound'
  | 'skipVeto'
  | 'endWarmup'
  | 'endMatch'
  | 'startMatch'
  | 'restoreBackup'
  | 'addTime'
  | 'broadcast';

const ALL_MATCH_CONTROLS: MatchControlId[] = [
  'pause',
  'unpause',
  'swap',
  'restartRound',
  'skipVeto',
  'endWarmup',
  'endMatch',
  'startMatch',
  'restoreBackup',
  'addTime',
  'broadcast',
];

/**
 * The admin controls a server transport supports, so the UI shows only the
 * buttons that work. Ready Up has no in-game veto (skip veto), and adds kick
 * and reset as server commands.
 */
export function adminCapabilitiesFor(transport: ServerTransport): {
  transport: ServerTransport;
  commands: string[];
  matchControls: MatchControlId[];
} {
  if (transport === 'fleet') {
    return {
      transport,
      commands: ['custom', 'kick', 'reset'],
      matchControls: ALL_MATCH_CONTROLS.filter((id) => id !== 'skipVeto'),
    };
  }
  return { transport, commands: ['custom'], matchControls: [...ALL_MATCH_CONTROLS] };
}

export function issuedBy(req: Request): IssuedBy & { actor: string | null } {
  const actor = requestActorId(req);
  return { userId: actor ?? 'unknown', name: actor ?? 'admin', root: isRootRequest(req), actor };
}

export function fleetResponseBody(outcome: FleetCommandOutcome & { auditId?: string }) {
  return {
    success: outcome.ok,
    transport: 'fleet' as const,
    status: outcome.status,
    errorCode: outcome.errorCode,
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.output !== undefined ? { response: outcome.output } : {}),
    ...(outcome.commandId ? { commandId: outcome.commandId } : {}),
    ...(outcome.matchSlug ? { matchSlug: outcome.matchSlug } : {}),
    ...(outcome.auditId ? { auditId: outcome.auditId } : {}),
    ...(outcome.serverName ? { serverName: outcome.serverName } : {}),
  };
}

export async function isFleetServer(serverId: string): Promise<boolean> {
  return (await transportOf(serverId)) === 'fleet';
}

/**
 * Answer the request with a fleet command when `serverId` is a Ready Up
 * server. Returns false (nothing sent, nothing answered) for an RCON server,
 * so the route carries on with its RCON command.
 */
export async function answerWithFleetCommand(
  req: Request,
  res: Response,
  serverId: string,
  name: CmdName,
  args: Record<string, unknown> = {}
): Promise<boolean> {
  if (!(await isFleetServer(serverId))) return false;
  const outcome = await runFleetCommand(serverId, name, args, issuedBy(req));
  res.status(outcome.httpStatus).json(fleetResponseBody(outcome));
  return true;
}

/** A button that has no Ready Up equivalent. */
export async function answerUnsupportedOnFleet(
  res: Response,
  serverId: string,
  what: string
): Promise<boolean> {
  if (!(await isFleetServer(serverId))) return false;
  res.status(400).json({
    success: false,
    transport: 'fleet',
    error: `${what} is not available on Ready Up servers`,
  });
  return true;
}

export function execLineError(line: string): string | null {
  const text = line.trim();
  if (!text || text.includes('\n') || Buffer.byteLength(text, 'utf8') > 512) {
    return 'exec takes one line of at most 512 bytes';
  }
  return null;
}

/** `exec` (root only, audited). 403 for anyone else. */
export async function fleetExec(
  req: Request,
  serverId: string,
  command: string
): Promise<{
  httpStatus: number;
  body: ReturnType<typeof fleetResponseBody> | { success: false; error: string };
}> {
  const who = issuedBy(req);
  if (!who.root) {
    return {
      httpStatus: 403,
      body: {
        success: false,
        error:
          'Raw console commands on Ready Up servers are for root admins only (the setup admin, Admin Steam IDs in Settings -> Sign-in, or an admin API token)',
      },
    };
  }
  const line = command.trim();
  const lineError = execLineError(line);
  if (lineError) return { httpStatus: 400, body: { success: false, error: lineError } };
  const outcome = await execOnFleetServer(serverId, line, who);
  return { httpStatus: outcome.httpStatus, body: fleetResponseBody(outcome) };
}

/**
 * The generic `/api/rcon/command` names (the admin console's command list)
 * as fleet commands. Null: no Ready Up equivalent.
 */
export function fleetCommandFor(input: {
  command: string;
  message?: unknown;
  round?: unknown;
  value?: unknown;
  map?: unknown;
}): { name: CmdName; args: Record<string, unknown> } | null {
  const base = input.command.replace(/^css_/, '').split(' ')[0];
  switch (base) {
    case 'pause':
      return { name: 'pause', args: { type: 'technical' } };
    case 'forcepause':
    case 'fp':
      return { name: 'pause', args: { type: 'admin' } };
    case 'unpause':
    case 'forceunpause':
    case 'fup':
      return { name: 'unpause', args: {} };
    case 'start':
    case 'forcestart':
    case 'force_ready':
    case 'forceready':
      return { name: base === 'start' ? 'start' : 'force_ready', args: {} };
    case 'switch':
    case 'swap':
      return { name: 'swap_teams', args: {} };
    case 'endmatch':
      return { name: 'end_match', args: { reason: 'admin' } };
    case 'map':
    case 'changemap':
      return typeof input.map === 'string' || typeof input.value === 'string'
        ? { name: 'change_map', args: { name: String(input.map ?? input.value) } }
        : null;
    case 'say':
    case 'asay':
      return typeof input.message === 'string'
        ? { name: 'say', args: { text: input.message.slice(0, 190), as_admin: base === 'asay' } }
        : null;
    default:
      return null;
  }
}
