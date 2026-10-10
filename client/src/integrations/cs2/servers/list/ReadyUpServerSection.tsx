/** A Ready Up server in its panel: whether it takes matches, and what can be done on it. */
import { Box, Typography } from '@mui/material';
import { mono, useModuleTranslation } from '../../../../module-sdk';
import { Facts } from '../fleet/SideSheet';
import { AvailabilityChip, AvailabilityReason } from '../fleet/readyup/AvailabilityChip';
import { ResetServerButton } from '../fleet/readyup/ResetServerButton';
import { FleetPlayers } from '../fleet/readyup/FleetPlayers';
import { FleetConsole } from '../fleet/readyup/FleetConsole';
import { useFleetServer } from '../fleet/readyup/useFleetServer';

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
            <Box key="connect" component="span" sx={mono}>
              {server.connect.address}
            </Box>,
          ],
          !!server.versions && [t('serversBoard.readyUp.sheet.version'), server.versions.core],
          server.versions?.cs2_build !== undefined && [
            t('serversBoard.readyUp.sheet.cs2'),
            String(server.versions?.cs2_build),
          ],
          [t('serversBoard.readyUp.sheet.lastSeen'), when(server.lastSeen)],
        ]}
      />
      <FleetPlayers server={server} onChanged={changed} />
      <FleetConsole server={server} />
    </Box>
  );
}
