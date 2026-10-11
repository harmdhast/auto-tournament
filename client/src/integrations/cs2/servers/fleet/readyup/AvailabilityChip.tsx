/** Whether a Ready Up server takes matches, and why not (api fleet/busyReason.ts). */
import { Chip, Typography } from '@mui/material';
import { tokens, useModuleTranslation } from '../../../../../module-sdk';
import type { FleetServer } from '../../../cs2.types';

const REASON_KEY: Record<string, string> = {
  local_match: 'managePage.servers.busyReason.localMatch',
  awaiting_reset: 'managePage.servers.busyReason.awaitingReset',
  match_disabled: 'managePage.servers.busyReason.matchDisabled',
  draining: 'managePage.servers.busyReason.draining',
  reserved: 'managePage.servers.busyReason.reserved',
};

type Availability = 'free' | 'busy' | 'spare' | 'draining' | 'offline';

export function availabilityOf(server: FleetServer): Availability {
  if (!server.online) return 'offline';
  if (server.availabilityReason === 'reserved') return 'spare';
  if (server.availability === 'draining') return 'draining';
  return server.availability === 'available' && !server.availabilityReason ? 'free' : 'busy';
}

const { color } = tokens;

/**
 * One colour per availability, shared by the dots, the chips and the admin
 * home: free green, in a match the accent, busy for another reason amber,
 * spare or draining blue, offline red, not enrolled muted.
 */
export function availabilityTone(server: FleetServer): string {
  if (server.status !== 'enrolled') return color.muted;
  switch (availabilityOf(server)) {
    case 'free':
      return color.live;
    case 'spare':
    case 'draining':
      return color.info;
    case 'offline':
      return color.ban;
    default:
      return !server.availabilityReason || server.availabilityReason === 'local_match'
        ? color.accent
        : 'warning.main';
  }
}

export function AvailabilityChip({ server }: { server: FleetServer }) {
  const { t } = useModuleTranslation('cs2');
  const state = availabilityOf(server);
  const tone = availabilityTone(server);
  const label = t(`serversBoard.readyUp.availability.${state}`);
  return (
    <Chip
      size="small"
      variant={state === 'free' ? 'filled' : 'outlined'}
      color={state === 'free' ? 'success' : 'default'}
      label={label}
      title={label}
      sx={state === 'free' ? undefined : { color: tone, borderColor: tone }}
      data-testid={`fleet-availability-${server.id}`}
    />
  );
}

function reasonKey(server: FleetServer): string | undefined {
  return server.online && server.availabilityReason
    ? REASON_KEY[server.availabilityReason]
    : undefined;
}

/** Whether AvailabilityReason has a line to show. */
export function hasAvailabilityReason(server: FleetServer): boolean {
  return reasonKey(server) !== undefined;
}

/** The reason line under a busy server; nothing when there is no reason this page knows. */
export function AvailabilityReason({ server }: { server: FleetServer }) {
  const { t } = useModuleTranslation('cs2');
  const key = reasonKey(server);
  if (!key) return null;
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      display="block"
      data-testid={`fleet-reason-${server.id}`}
      title={t(key, { slug: server.availabilityDetail ?? '' })}
    >
      {t(key, { slug: server.availabilityDetail ?? '' })}
    </Typography>
  );
}
