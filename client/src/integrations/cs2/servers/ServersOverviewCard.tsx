import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Card, CardContent, Skeleton, Stack, Typography } from '@mui/material';
import { api, links, radii, tokens, useModuleTranslation } from '../../../module-sdk';
import {
  SERVER_AVAILABILITY_ENDPOINT,
  type ServerAvailability,
  type ServerFleetCounts,
} from '../cs2.types';

/** Online / in-match / free / offline from the allocator's view of the fleet. */
function countFleet(availability: ServerAvailability): ServerFleetCounts {
  const counts: ServerFleetCounts = {
    online: 0,
    inMatch: 0,
    busy: 0,
    draining: 0,
    spare: 0,
    free: 0,
    offline: 0,
    total: 0,
  };
  for (const server of availability.servers ?? []) {
    counts.total += 1;
    if (!server.online) {
      counts.offline += 1;
      continue;
    }
    counts.online += 1;
    if (server.allocatable) counts.free += 1;
    else if (server.busyReason === 'reserved' || server.notAllocatableReason === 'reserved')
      counts.spare += 1;
    else if (server.matchSlug) counts.inMatch += 1;
    else if (server.busyReason === 'draining') counts.draining += 1;
    else if (!server.busyReason) counts.inMatch += 1;
    else counts.busy += 1;
  }
  return counts;
}

/** The card's numbers, asked once when it mounts: the fleet breakdown from the allocator's availability route. */
function useFleetSummary(): { loaded: boolean; fleet: ServerFleetCounts | null } {
  const [loaded, setLoaded] = useState(false);
  const [fleet, setFleet] = useState<ServerFleetCounts | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<ServerAvailability>(SERVER_AVAILABILITY_ENDPOINT)
      .catch(() => null)
      .then((availability) => {
        if (cancelled) return;
        setFleet(availability ? countFleet(availability) : null);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { loaded, fleet };
}

/** The server list's availability colours (fleet/readyup/AvailabilityChip.tsx availabilityTone). */
const TONE = {
  inMatch: tokens.color.accent,
  busy: 'warning.main',
  draining: tokens.color.info,
  spare: tokens.color.info,
  free: tokens.color.live,
  offline: tokens.color.ban,
} as const;

/** A thin stacked bar: in a match / busy / draining / spare / free / offline, in that order. */
function FleetBar({ fleet }: { fleet: ServerFleetCounts }) {
  const total = fleet.total || 1;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <Box
      aria-hidden
      sx={{
        height: 6,
        borderRadius: radii.pill,
        bgcolor: 'background.surface2',
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      <Box sx={{ width: pct(fleet.inMatch), bgcolor: TONE.inMatch }} />
      <Box sx={{ width: pct(fleet.busy), bgcolor: TONE.busy }} />
      <Box sx={{ width: pct(fleet.draining), bgcolor: TONE.draining }} />
      <Box sx={{ width: pct(fleet.spare), bgcolor: TONE.spare }} />
      <Box sx={{ width: pct(fleet.free), bgcolor: TONE.free }} />
      <Box sx={{ width: pct(fleet.offline), bgcolor: TONE.offline }} />
    </Box>
  );
}

/**
 * Right-column "Servers" summary: online/total and a stacked in-match/free/
 * offline bar, from the same server-availability endpoint Manage uses.
 *
 * It asks for them itself (client API 0.2.0): `AdminHomeResourcesProps` is
 * empty, the admin home hands it nothing.
 */
export function ServersOverviewCard() {
  const { t } = useModuleTranslation('cs2');
  const { loaded, fleet } = useFleetSummary();

  return (
    <Card variant="outlined" data-testid="admin-home-servers-card">
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={1.5}>
          <Typography variant="subtitle1" fontWeight={600}>
            {t('dashboard.servers.title')}
          </Typography>
          <Typography
            component={RouterLink}
            to={links.servers()}
            variant="body2"
            color="text.secondary"
            sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
          >
            {t('dashboard.servers.open')}
          </Typography>
        </Box>

        {!loaded ? (
          <Stack spacing={1} data-testid="admin-home-servers-card-loading">
            <Skeleton variant="text" width="40%" height={40} />
            <Skeleton variant="rounded" height={6} />
            <Skeleton variant="text" />
          </Stack>
        ) : !fleet || fleet.total === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('dashboard.servers.none')}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            <Box display="flex" alignItems="baseline" gap={1}>
              <Typography variant="h4" fontWeight={700}>
                {fleet.online}/{fleet.total}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('dashboard.servers.online')}
              </Typography>
            </Box>
            <FleetBar fleet={fleet} />
            {(['inMatch', 'busy', 'draining', 'spare', 'free', 'offline'] as const)
              .filter((k) => fleet[k] > 0 || k === 'inMatch' || k === 'free' || k === 'offline')
              .map((k) => (
                <Box key={k} display="flex" justifyContent="space-between" alignItems="center">
                  <Box display="flex" alignItems="center" gap={1}>
                    <Box
                      aria-hidden
                      sx={{ width: 8, height: 8, borderRadius: radii.pill, bgcolor: TONE[k] }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {t(`dashboard.servers.${k}`)}
                    </Typography>
                  </Box>
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    data-testid={`admin-home-servers-${k}`}
                  >
                    {fleet[k]}
                  </Typography>
                </Box>
              ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
