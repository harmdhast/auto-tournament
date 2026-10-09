import { test, expect } from '@playwright/test';
import { CS2_MIGRATIONS } from '../../api/src/integrations/cs2/migrations';
import { effectiveBusyReason, parseBusyDetail, parseBusyReason } from '../../api/src/integrations/cs2/fleet/busyReason';

/**
 * Why a Ready Up server takes no match (FLEET.md §8): the reason it reports with
 * its availability is kept per server and shown on the servers list and in the
 * pool status. Older Ready Up sends free text, read as no reason.
 *
 * @tag api
 * @tag fleet
 */

test.describe('Fleet busy reason: parsing', () => {
  test('only the known reasons are kept; legacy text is null', () => {
    expect(parseBusyReason('awaiting_reset')).toBe('awaiting_reset');
    expect(parseBusyReason('local_match')).toBe('local_match');
    expect(parseBusyReason('series_end')).toBeNull();
    expect(parseBusyReason('assigned')).toBeNull();
    expect(parseBusyReason('reserved')).toBeNull(); // platform-only
    expect(parseBusyReason(undefined)).toBeNull();
    expect(parseBusyReason(3)).toBeNull();
    expect(parseBusyDetail('x'.repeat(300))).toHaveLength(128);
    expect(parseBusyDetail('  cup\u0007-final ')).toBe('cup-final');
    expect(parseBusyDetail('')).toBeNull();
    expect(parseBusyDetail(null)).toBeNull();
  });

  test('match off and a held spare win over the stored reason in that order', () => {
    expect(effectiveBusyReason('local_match', { matchDisabled: true, reserved: false })).toBe('match_disabled');
    expect(effectiveBusyReason('local_match', { matchDisabled: false, reserved: true })).toBe('local_match');
    expect(effectiveBusyReason(null, { matchDisabled: false, reserved: true })).toBe('reserved');
    expect(effectiveBusyReason(null, { matchDisabled: false, reserved: false })).toBeNull();
  });

  test('the availability reason migration is declared last', () => {
    expect(CS2_MIGRATIONS.at(-1)?.id).toBe('037-fleet-availability-reason');
  });
});
