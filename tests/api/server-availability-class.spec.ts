import { expect, test } from '@playwright/test';
import {
  classifyAllocation,
  countFleet,
  serverRank,
} from '../../client/src/integrations/cs2/servers/availabilityClass';
import type {
  ServerAllocationInfo,
  ServerAvailability,
} from '../../client/src/integrations/cs2/cs2.types';

type Reason = NonNullable<ServerAllocationInfo['notAllocatableReason']>;
type Busy = NonNullable<ServerAllocationInfo['busyReason']>;

/** The two classifications as they were before they shared a module: the oracle. */
function legacyBucket(server: ServerAllocationInfo): string {
  if (!server.online) return 'offline';
  if (server.allocatable) return 'free';
  if (server.busyReason === 'reserved' || server.notAllocatableReason === 'reserved')
    return 'spare';
  if (server.matchSlug) return 'inMatch';
  if (server.busyReason === 'draining') return 'draining';
  if (!server.busyReason) return 'inMatch';
  return 'busy';
}

function legacyRank(
  server: ServerAllocationInfo,
  match: { phase: string | null } | undefined,
  checking: boolean
): number {
  const PHASE_RANK: Record<string, number> = { live: 0, knife: 1, warmup: 2, veto: 3 };
  if (!server.online) return checking && !server.updatedAt ? 13 : 14;
  if (match) return PHASE_RANK[match.phase ?? ''] ?? 4;
  if (server.allocatable) return 10;
  if (
    server.notAllocatableReason === 'grace-window' ||
    server.busyReason === 'reserved' ||
    server.busyReason === 'draining'
  )
    return 11;
  return 12;
}

const REASONS: Array<Reason | null | undefined> = [
  undefined,
  null,
  'offline',
  'busy',
  'reserved',
  'grace-window',
  'demo-upload',
  'cs2-out-of-date',
  'cs2-unverified',
];
const BUSY: Array<Busy | null | undefined> = [
  undefined,
  null,
  'local_match',
  'awaiting_reset',
  'match_disabled',
  'draining',
  'reserved',
];
const MATCHES = [
  undefined,
  { phase: null },
  { phase: 'live' },
  { phase: 'knife' },
  { phase: 'warmup' },
  { phase: 'veto' },
  { phase: 'other' },
];

function* servers(): Generator<ServerAllocationInfo> {
  for (const online of [true, false])
    for (const allocatable of [true, false])
      for (const matchSlug of [null, 'm1'])
        for (const updatedAt of [null, 1])
          for (const notAllocatableReason of REASONS)
            for (const busyReason of BUSY)
              yield {
                id: 's',
                name: 's',
                online,
                status: null,
                matchSlug,
                matchNumber: null,
                matchRound: null,
                updatedAt,
                inGraceWindow: false,
                secondsUntilReady: null,
                allocatable,
                notAllocatableReason,
                busyReason,
              };
}

test.describe('server availability classes', { tag: ['@api'] }, () => {
  test('every server lands in the bucket it did before', () => {
    let n = 0;
    for (const server of servers()) {
      const counts = countFleet({ servers: [server] } as ServerAvailability);
      const bucket = classifyAllocation(server);
      expect(bucket, JSON.stringify(server)).toBe(legacyBucket(server));
      expect(counts.total).toBe(1);
      expect(counts[bucket], JSON.stringify(server)).toBe(1);
      expect(counts.online).toBe(server.online ? 1 : 0);
      n += 1;
    }
    expect(n).toBeGreaterThan(1000);
  });

  test('tiles sort in the order they did before', () => {
    for (const server of servers())
      for (const match of MATCHES)
        for (const checking of [true, false])
          expect(
            serverRank(server, match as never, checking),
            JSON.stringify({ server, match, checking })
          ).toBe(legacyRank(server, match, checking));
  });
});
