import { useState } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { api, apiErrorMessage, useModuleTranslation } from '../../../../module-sdk';
import { SectionTitle } from './MachineSheetParts';
import type { Fleet } from './useFleet';

/** 10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, fc00::/7, fe80::/10, ::1. */
function isPrivateAddress(host: string): boolean {
  const h = host.trim().toLowerCase();
  const m = /^(\d+)\.(\d+)\./.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
}

/**
 * Where players outside the machine's network connect: csm reports the machine's own
 * address, a LAN one behind a router, which remote players cannot reach (#348). Set
 * once here; every server on the machine uses it.
 */
export function PublicAddress({
  fleet,
  hostId,
  value,
  reported,
}: {
  fleet: Fleet;
  hostId: string;
  value: string;
  reported: string | null;
}) {
  const { t } = useModuleTranslation('cs2');
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (next: string) => {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/fleet/hosts/${encodeURIComponent(hostId)}`, {
        publicAddress: next.trim() || null,
      });
      await fleet.load();
    } catch (e) {
      setError(
        apiErrorMessage(
          e,
          t('machinesPanel.publicAddress.failed', { defaultValue: 'Could not save the address' })
        )
      );
    } finally {
      setBusy(false);
    }
  };
  const lanOnly = !value && !!reported && isPrivateAddress(reported);
  return (
    <Stack gap={1.25} data-testid="machine-public-address">
      <SectionTitle>
        {t('machinesPanel.publicAddress.title', { defaultValue: 'Public address' })}
      </SectionTitle>
      {lanOnly && (
        <Alert severity="warning" data-testid="machine-public-address-warning">
          {t('machinesPanel.publicAddress.lanOnly', {
            defaultValue:
              'Players connect to {{address}}, a local address: only players on the same network can join. Set the address players outside it use.',
            address: reported,
          })}
        </Alert>
      )}
      <Typography variant="body2" color="text.secondary">
        {t('machinesPanel.publicAddress.help', {
          defaultValue:
            'The IP address or host name players outside this network connect to (forward the game ports on your router). Empty: the address the machine reports.',
        })}
      </Typography>
      <Stack direction="row" gap={1} alignItems="flex-start" flexWrap="wrap">
        <TextField
          size="small"
          label={t('machinesPanel.publicAddress.label', { defaultValue: 'Public IP or host name' })}
          placeholder={reported ?? ''}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          error={!!error}
          helperText={error || undefined}
          sx={{ flex: '1 1 220px' }}
          inputProps={{ 'data-testid': 'machine-public-address-input' }}
        />
        <Button
          variant="contained"
          size="small"
          disabled={busy || draft.trim() === value}
          onClick={() => void save(draft)}
          sx={{ mt: 0.5 }}
        >
          {t('machinesPanel.publicAddress.save', { defaultValue: 'Save' })}
        </Button>
        {value && (
          <Button
            size="small"
            disabled={busy}
            onClick={() => {
              setDraft('');
              void save('');
            }}
            sx={{ mt: 0.5 }}
          >
            {t('machinesPanel.publicAddress.clear', { defaultValue: 'Use the reported address' })}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
