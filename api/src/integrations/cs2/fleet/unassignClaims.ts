/** Unassigns already sent or in flight, keyed `${server}:${slug}:${epoch}`. */
const sent = new Set<string>();
/** The keys claimed for the current connection, cleared per server on hello. */
const claimedHere = new Set<string>();

export function unassignKey(fleetServerId: string, slug: string, epoch: number): string {
  return `${fleetServerId}:${slug}:${epoch}`;
}

export function isClaimed(key: string): boolean {
  return sent.has(key);
}

/** True when this unassign was not sent yet; the caller then owns it. */
export function claimUnassign(key: string): boolean {
  if (sent.has(key)) return false;
  sent.add(key);
  if (sent.size > 10_000) sent.clear();
  return true;
}

/** As `claimUnassign`, and released with the connection (`forgetConnectionClaims`). */
export function claimUnassignOnConnection(key: string): boolean {
  if (!claimUnassign(key)) return false;
  claimedHere.add(key);
  return true;
}

/**
 * Claims an unassign for the current connection: released on hello (forgetConnectionClaims) or by
 * releaseUnassign. A fence's earlier claim does not block it (a server that lost the fence is told again).
 */
export function claimUnassignForConnection(key: string): boolean {
  if (claimedHere.has(key)) return false;
  claimedHere.add(key);
  sent.add(key);
  return true;
}

export function releaseUnassign(key: string): void {
  sent.delete(key);
  claimedHere.delete(key);
}

export function forgetConnectionClaims(fleetServerId: string): void {
  for (const key of claimedHere) {
    if (!key.startsWith(`${fleetServerId}:`)) continue;
    claimedHere.delete(key);
    sent.delete(key);
  }
}
