/** Who is on a Ready Up server, from its latest snapshot, and kicking one of them. */
import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { api, apiErrorMessage, useModuleTranslation, useSnackbar } from '../../../../../module-sdk';
import type { FleetPlayer, FleetServer } from '../../../cs2.types';

const TEAM_ORDER: FleetPlayer['team'][] = ['ct', 't', 'spectator', 'none'];

export function FleetPlayers({
  server,
  onChanged,
}: {
  server: FleetServer;
  onChanged?: () => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const [kicking, setKicking] = useState<FleetPlayer | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const players = [...(server.players ?? [])].sort(
    (a, b) =>
      TEAM_ORDER.indexOf(a.team) - TEAM_ORDER.indexOf(b.team) || a.name.localeCompare(b.name)
  );

  const kick = async () => {
    if (!kicking || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/fleet/servers/${server.id}/kick`, {
        steamid64: kicking.steamid64,
        ...(message.trim() ? { message: message.trim() } : {}),
      });
      showSnackbar(t('serversBoard.readyUp.players.kicked', { name: kicking.name }), 'success');
      setKicking(null);
      setMessage('');
      onChanged?.();
    } catch (err) {
      showError(apiErrorMessage(err, t('serversBoard.readyUp.players.kickFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} mb={1}>
        {t('serversBoard.readyUp.players.title')}
      </Typography>
      {players.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('serversBoard.readyUp.players.empty')}
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          {players.map((p) => (
            <Box
              key={p.steamid64}
              data-testid={`fleet-player-${p.steamid64}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {p.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t(`serversBoard.readyUp.players.team.${p.team}`)}
              </Typography>
              <Button
                size="small"
                color="error"
                disabled={!server.online}
                onClick={() => setKicking(p)}
                data-testid={`fleet-kick-${p.steamid64}`}
              >
                {t('serversBoard.readyUp.players.kick')}
              </Button>
            </Box>
          ))}
        </Box>
      )}
      <Dialog open={kicking !== null} onClose={() => setKicking(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {t('serversBoard.readyUp.players.kickTitle', { name: kicking?.name ?? '' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('serversBoard.readyUp.players.kickMessage')}
          </Typography>
          <TextField
            fullWidth
            size="small"
            label={t('serversBoard.readyUp.players.kickReason')}
            value={message}
            onChange={(e) => setMessage(e.target.value.replace(/[\r\n]/g, ' '))}
            inputProps={{ maxLength: 128 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setKicking(null)}>
            {t('serversBoard.close', { defaultValue: 'Close' })}
          </Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => void kick()}>
            {t('serversBoard.readyUp.players.kick')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
