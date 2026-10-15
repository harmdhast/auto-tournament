/** Whether a Ready Up server takes matches, and why not (api fleet/busyReason.ts). */
import { Chip, Typography } from '@mui/material';
import { tokens, useModuleTranslation } from '../../../../../module-sdk';
import type { FleetServer } from '../../../cs2.types';
import { BUSY_REASON_KEY, type AvailabilityClass } from '../../availabilityClass';
import { availabilityClassTone, busyTone } from '../serverStateMark';

type Availability = Exclude<AvailabilityClass, 'inMatch'>;

export function availabilityOf(server: FleetServer): Availability {
  if (!server.online) return 'offline';
  if (server.availabilityReason === 'reserved') return 'spare';
  if (server.availability === 'draining') return 'draining';
  return server.availability === 'available' && !server.availabilityReason ? 'free' : 'busy';
}

const { color } = tokens;

/** The colour of a server's availability: not enrolled muted, otherwise `availabilityClassTone`. */
export function availabilityTone(server: FleetServer): string {
  if (server.status !== 'enrolled') return color.muted;
  const state = availabilityOf(server);
  return state === 'busy' ? busyTone(server.availabilityReason) : availabilityClassTone[state];
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
    ? BUSY_REASON_KEY[server.availabilityReason]
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
