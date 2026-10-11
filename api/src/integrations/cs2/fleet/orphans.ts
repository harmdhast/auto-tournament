import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { ulid } from './credentials';
import { cs2ServerIdOf } from './link';
import { awaitCommandResult } from './reliable';
import { activeProposal } from './failover';

export type OrphanReason = 'cancelled' | 'ended' | 'superseded';

export interface OrphanReport {
  reason: string | null;
  detail: string | null;
  state: { match_id: string; epoch: number } | null;
}

const ANSWER_TIMEOUT_MS = 10_000;
const nowS = () => Math.floor(Date.now() / 1000);

interface OrphanDeps {
  unassign(
    fleetServerId: string,
    slug: string,
    epoch: number,
    reason: OrphanReason
  ): Promise<string>;
  epochOf(slug: string): Promise<number | null>;
}

let deps: OrphanDeps;

export function bindOrphanDeps(bound: OrphanDeps): void {
  deps = bound;
}

/** Unassigns already sent or in flight: `${server}:${slug}:${epoch}`. Shared with the stale-epoch check. */
const sent = new Set<string>();
/** The keys the orphan path claimed, cleared per server on hello. */
const claimedHere = new Set<string>();

/** True when this unassign was not sent yet; the caller then owns it. */
export function claimUnassign(key: string): boolean {
  if (sent.has(key)) return false;
  sent.add(key);
  if (sent.size > 10_000) sent.clear();
  return true;
}

/** Why the platform no longer runs `slug` on this fleet server; null when it still does. */
export async function orphanReason(
  slug: string,
  fleetServerId: string
): Promise<OrphanReason | null> {
  const match = await db.queryOneAsync<{ status: string; server_id: string | null }>(
    'SELECT status, server_id FROM matches WHERE slug = ?',
    [slug]
  );
  if (!match) return 'cancelled';
  if (match.status === 'completed') return 'ended';
  if (match.server_id && match.server_id !== (await cs2ServerIdOf(fleetServerId))) {
    return 'superseded';
  }
  return null;
}

export function forgetDroppedOrphans(fleetServerId: string): void {
  for (const key of claimedHere) {
    if (!key.startsWith(`${fleetServerId}:`)) continue;
    claimedHere.delete(key);
    sent.delete(key);
  }
}

/** A server reporting a platform assignment the platform no longer runs gets `match.unassign`. */
export async function dropOrphanAssignment(
  fleetServerId: string,
  report: OrphanReport
): Promise<boolean> {
  if (report.reason !== 'assigned' && report.reason !== 'awaiting_reset') return false;
  const slug = report.state?.match_id ?? report.detail;
  if (!slug) return false;
  const epoch = report.state?.epoch ?? (await deps.epochOf(slug));
  if (!epoch) return false;
  const key = `${fleetServerId}:${slug}:${epoch}`;
  if (sent.has(key)) return false;
  if ((await activeProposal(slug))?.status === 'moving') return false;
  const reason = await orphanReason(slug, fleetServerId);
  if (!reason) return false;
  if (!claimUnassign(key)) return false;
  claimedHere.add(key);

  const command = `match.unassign ${slug} (${reason})`;
  const auditId = ulid();
  await db.runAsync(
    `INSERT INTO cs2_fleet_audit (id, actor, server_id, match_slug, command, status, created_at)
     VALUES (?, 'system', ?, ?, ?, 'pending', ?)`,
    [auditId, fleetServerId, slug, command, nowS()]
  );
  log.info(
    `[FLEET] ${fleetServerId} holds ${slug} epoch ${epoch}, which the platform no longer runs (${reason})`
  );
  let messageId: string | null = null;
  try {
    messageId = await deps.unassign(fleetServerId, slug, epoch, reason);
    const answer = await awaitCommandResult(messageId, ANSWER_TIMEOUT_MS);
    await closeAudit(
      auditId,
      messageId,
      answer?.status ?? 'timeout',
      answer?.errorCode ?? null,
      !!answer
    );
  } catch (error) {
    sent.delete(key);
    claimedHere.delete(key);
    await closeAudit(auditId, messageId, 'error', (error as Error).message.slice(0, 120), false);
    throw error;
  }
  return true;
}

async function closeAudit(
  auditId: string,
  messageId: string | null,
  status: string,
  errorCode: string | null,
  answered: boolean
): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_fleet_audit SET message_id = ?, status = ?, error_code = ?, answered_at = ? WHERE id = ?`,
    [messageId, status, errorCode, answered ? nowS() : null, auditId]
  );
}
