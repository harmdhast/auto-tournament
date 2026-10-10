/** Whether a Ready Up server takes matches, and why not (api fleet/busyReason.ts). */
import { Chip, Typography } from '@mui/material';
import { useModuleTranslation } from '../../../../../module-sdk';
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

export function AvailabilityChip({ server }: { server: FleetServer }) {
  const { t } = useModuleTranslation('cs2');
  const state = availabilityOf(server);
  return (
    <Chip
      size="small"
      variant={state === 'free' ? 'filled' : 'outlined'}
      color={state === 'free' ? 'success' : 'default'}
      label={t(`serversBoard.readyUp.availability.${state}`)}
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
    >
      {t(key, { slug: server.availabilityDetail ?? '' })}
    </Typography>
  );
}
