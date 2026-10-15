import type { BusyReason } from './protocol/v1/types';

const REPORTED = new Set<string>(['local_match', 'awaiting_reset', 'match_disabled', 'draining']);
const DETAIL_MAX = 128;

/** A reason Ready Up reported; anything else (legacy text, platform-only values) is null. */
export function parseBusyReason(raw: unknown): BusyReason | null {
  return typeof raw === 'string' && REPORTED.has(raw) ? (raw as BusyReason) : null;
}

/** The detail Ready Up sent with it: trimmed, control characters dropped, at most 128 characters. */
export function parseBusyDetail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, DETAIL_MAX);
  return clean || null;
}

/** The reason to show: match off first, then what the server said, then a held spare. */
export function effectiveBusyReason(
  stored: BusyReason | null,
  flags: { matchDisabled: boolean; reserved: boolean }
): BusyReason | null {
  if (flags.matchDisabled) return 'match_disabled';
  if (stored) return stored;
  return flags.reserved ? 'reserved' : null;
}
