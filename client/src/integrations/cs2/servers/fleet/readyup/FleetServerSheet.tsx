/** A Ready Up server's own panel: whether it takes matches, and what can be done on it. */
import { Box, Button, Typography } from '@mui/material';
import { mono, useModuleTranslation } from '../../../../../module-sdk';
import { Facts, SideSheet } from '../SideSheet';
import { AvailabilityChip, AvailabilityReason } from './AvailabilityChip';
import { ResetServerButton } from './ResetServerButton';
import { useFleetServer } from './useFleetServer';

export function FleetServerSheet({
  serverId,
  onClose,
}: {
  serverId: string | null;
  onClose: () => void;
}) {
  const { t, i18n } = useModuleTranslation('cs2');
  const { server, loaded, gone, reload } = useFleetServer(serverId);
  const when = (s: number | null) => (s ? new Date(s * 1000).toLocaleString(i18n.language) : '—');

  return (
    <SideSheet
      open={serverId !== null}
      onClose={onClose}
      testId="fleet-server-sheet"
      title={server?.name ?? ''}
    >
      {gone ? (
        <Box>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('serversBoard.readyUp.sheet.gone')}
          </Typography>
          <Button variant="outlined" onClick={onClose}>
            {t('serversBoard.close', { defaultValue: 'Close' })}
          </Button>
        </Box>
      ) : server ? (
        <Box sx={{ display: 'grid', gap: 3 }}>
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
                  <ResetServerButton server={server} onDone={() => void reload()} />
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
        </Box>
      ) : (
        loaded && null
      )}
    </SideSheet>
  );
}
