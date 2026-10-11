/** A Ready Up server in its panel: whether it takes matches, and what can be done on it. */
import { Box, Typography } from '@mui/material';
import { useModuleTranslation } from '../../../../module-sdk';
import { Facts } from '../fleet/SideSheet';
import { AvailabilityChip, AvailabilityReason } from '../fleet/readyup/AvailabilityChip';
import { ResetServerButton } from '../fleet/readyup/ResetServerButton';
import { FleetPlayers } from '../fleet/readyup/FleetPlayers';
import { FleetConsole } from '../fleet/readyup/FleetConsole';
import { useFleetServer } from '../fleet/readyup/useFleetServer';
import { CopyConnect } from './CopyConnect';
import { FleetServerPushSection } from './FleetServerPushSection';

export function ReadyUpServerSection({
  fleetId,
  onChanged,
}: {
  fleetId: string;
  onChanged: () => void;
}) {
  const { t, i18n } = useModuleTranslation('cs2');
  const { server, gone, reload } = useFleetServer(fleetId);
  const when = (s: number | null) => (s ? new Date(s * 1000).toLocaleString(i18n.language) : '—');
  const changed = () => {
    void reload();
    onChanged();
  };

  if (gone) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="server-panel-gone">
        {t('serversBoard.readyUp.sheet.gone')}
      </Typography>
    );
  }
  if (!server) return null;
  return (
    <Box data-testid="server-panel-readyup" sx={{ display: 'grid', gap: 3 }}>
      {!server.online && (
        <Typography variant="body2" color="error" data-testid="fleet-server-offline">
          {t('serversBoard.readyUp.sheet.offline')}
        </Typography>
      )}
      <Facts
        items={[
          [
            t('serversBoard.readyUp.sheet.state'),
            <Box key="state" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <AvailabilityChip server={server} />
                <AvailabilityReason server={server} />
              </Box>
              <ResetServerButton server={server} onDone={changed} />
            </Box>,
          ],
          !!server.connect && [
            t('serversBoard.readyUp.sheet.connect'),
            <CopyConnect key="connect" address={server.connect.address} />,
          ],
          !!server.connect &&
            !!server.host?.tv_port && [
              'GOTV',
              <CopyConnect key="gotv" address={`${server.connect.host}:${server.host.tv_port}`} />,
            ],
          !!server.versions && [t('serversBoard.readyUp.sheet.version'), server.versions.core],
          !!server.versions && [
            t('serversBoard.readyUp.sheet.update', { defaultValue: 'Update' }),
            server.readyUpUpdate?.state === 'outdated'
              ? t('fleetPanel.updateAvailable', {
                  version: server.readyUpUpdate.latest,
                  defaultValue: 'Update available: {{version}}',
                })
              : server.readyUpUpdate?.state === 'current'
                ? t('fleetPanel.upToDate', { defaultValue: 'Up to date' })
                : t('fleetPanel.noUpdateCheck', { defaultValue: 'No update check yet' }),
          ],
          !!server.token && [
            t('serversBoard.readyUp.sheet.token', { defaultValue: 'Token renewal' }),
            when(server.token.rotationDueAt),
          ],
          server.versions?.cs2_build !== undefined && [
            t('serversBoard.readyUp.sheet.cs2'),
            String(server.versions?.cs2_build),
          ],
          [t('serversBoard.readyUp.sheet.lastSeen'), when(server.lastSeen)],
        ]}
      />
      <FleetPlayers server={server} onChanged={changed} />
      <FleetConsole server={server} />
      {server.status === 'enrolled' && (
        <Box>
          <Typography variant="subtitle2" fontWeight={600} mb={1}>
            {t('serversBoard.readyUp.tabs.push')}
          </Typography>
          <FleetServerPushSection server={server} />
        </Box>
      )}
    </Box>
  );
}
