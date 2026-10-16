import { test, expect } from '@playwright/test';
import { sweepDue } from '../../api/src/integrations/cs2/fleet/failover';

/**
 * The stuck-move sweep (fleet/failover.ts) waits for the fleet to reconnect after a start:
 * a target that took the match is not told to drop it before its ack is replayed.
 *
 * @tag api
 */
test.describe('Stuck-move sweep after a start', () => {
  test('not due inside the startup delay, due after it', () => {
    expect(sweepDue(1_005, 1_000)).toBe(false);
    expect(sweepDue(1_029, 1_000)).toBe(false);
    expect(sweepDue(1_030, 1_000)).toBe(true);
    expect(sweepDue(2_000, 1_000)).toBe(true);
  });
});
