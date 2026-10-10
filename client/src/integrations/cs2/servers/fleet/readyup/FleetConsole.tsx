/** One console line on a Ready Up server (fleet `exec`, root admins only, FLEET.md D10). */
import { useState } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { api, mono, useAuth, useModuleTranslation } from '../../../../../module-sdk';
import type { FleetServer } from '../../../cs2.types';

type Line = { command: string; output: string; failed: boolean };

export function FleetConsole({ server }: { server: FleetServer }) {
  const { t } = useModuleTranslation('cs2');
  const { isRoot } = useAuth();
  const [value, setValue] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  const send = async () => {
    const command = value.trim();
    if (!command || busy || !server.linkedServerId) return;
    setBusy(true);
    try {
      const res = await api.post<{ success: boolean; response?: string; error?: string }>(
        '/api/rcon/command',
        {
          serverId: server.linkedServerId,
          command: 'custom',
          value: command,
        }
      );
      setLines((prev) =>
        [
          ...prev,
          {
            command,
            output: res.response || t('serversBoard.readyUp.console.noOutput'),
            failed: !res.success,
          },
        ].slice(-20)
      );
      setValue('');
    } catch (err) {
      // A 403 (not root) reads as root only, never as the raw refusal.
      if (/forbidden|root/i.test((err as Error).message)) setRefused(true);
      else
        setLines((prev) =>
          [...prev, { command, output: (err as Error).message, failed: true }].slice(-20)
        );
    } finally {
      setBusy(false);
    }
  };

  const note = (text: string) => (
    <Typography variant="body2" color="text.secondary">
      {text}
    </Typography>
  );

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} mb={1}>
        {t('serversBoard.readyUp.console.title')}
      </Typography>
      {!isRoot || refused ? (
        note(t('serversBoard.readyUp.console.rootOnly'))
      ) : !server.linkedServerId ? (
        note(t('serversBoard.readyUp.console.notLinked'))
      ) : (
        <>
          {lines.length > 0 && (
            <Box
              component="pre"
              data-testid="fleet-console-output"
              sx={{
                ...mono,
                fontSize: '0.8rem',
                m: 0,
                mb: 1,
                p: 1,
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                bgcolor: 'action.hover',
                borderRadius: 1,
              }}
            >
              {lines.map((l, i) => (
                <Box
                  key={i}
                  component="span"
                  sx={{ display: 'block', color: l.failed ? 'error.main' : undefined }}
                >
                  {`> ${l.command}\n${l.output}`}
                </Box>
              ))}
            </Box>
          )}
          <TextField
            fullWidth
            size="small"
            placeholder={t('serversBoard.readyUp.console.placeholder')}
            value={value}
            disabled={busy || !server.online}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
            inputProps={{
              maxLength: 512,
              'data-testid': 'fleet-console-input',
              style: { fontFamily: 'monospace' },
            }}
          />
        </>
      )}
    </Box>
  );
}
