/**
 * The Servers page's "Keys and enrollment" tab (FLEET.md §4): the reusable
 * fleet keys Ready Up servers enroll with (csm, containers). A key is shown
 * once when created; a key can be revoked. One-time codes and the servers
 * themselves live on the server list (list/ServerList.tsx).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { KeyIcon, ProhibitIcon } from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  ConfirmDialog,
  mono,
  Row,
  RowList,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import type { Secret } from './list/useFleetServerActions';
import type { FleetKey, FleetKeysResponse } from '../cs2.types';
import { ServerSection } from './ServerSection';
import { formatWhen } from './time';
import { useTopic } from '../../../module-sdk';

export default function FleetPanel({ showSecret }: { showSecret: (secret: Secret) => void }) {
  const { t, i18n } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [keys, setKeys] = useState<FleetKey[]>([]);
  const [keyOpen, setKeyOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<FleetKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyForm, setKeyForm] = useState({
    name: '',
    namePrefix: '',
    maxServers: '',
    expiresInDays: '',
    autoLink: false,
    skins: false,
  });
  const load = useCallback(async () => {
    try {
      const k = await api.get<FleetKeysResponse>('/api/fleet/keys');
      setKeys(k.keys || []);
    } catch (err) {
      console.error('Failed to load the fleet keys', err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  // Re-read when the fleet changes (the `fleet` topic), not on a timer.
  useTopic('fleet', load, { admin: true });

  const createKey = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: keyForm.name.trim() };
      if (keyForm.namePrefix.trim()) body.namePrefix = keyForm.namePrefix.trim();
      if (keyForm.maxServers.trim()) body.maxServers = Number(keyForm.maxServers);
      if (keyForm.expiresInDays.trim()) body.expiresInDays = Number(keyForm.expiresInDays);
      if (keyForm.autoLink) body.autoLink = true;
      if (keyForm.skins) body.skins = true;
      const res = await api.post<{ key: FleetKey; value: string }>('/api/fleet/keys', body);
      setKeyOpen(false);
      setKeyForm({
        name: '',
        namePrefix: '',
        maxServers: '',
        expiresInDays: '',
        autoLink: false,
        skins: false,
      });
      showSecret({
        kind: 'key',
        value: res.value,
        expiresAt: res.key.expiresAt,
        name: res.key.name,
      });
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.createKey')));
    } finally {
      setBusy(false);
    }
  };

  const confirmRevokeKey = async () => {
    if (!pendingKey) return;
    setBusy(true);
    try {
      await api.delete(`/api/fleet/keys/${pendingKey.id}`);
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.action')));
    } finally {
      setBusy(false);
      setPendingKey(null);
    }
  };

  const locale = i18n.language;
  const liveKeys = keys.filter((k) => !k.revoked);

  return (
    <ServerSection
      id="fleet-keys"
      data-testid="fleet-panel"
      title={t('fleetPanel.keysTitle')}
      action={
        <Button
          size="small"
          variant="outlined"
          startIcon={<KeyIcon />}
          onClick={() => setKeyOpen(true)}
        >
          {t('fleetPanel.createKey')}
        </Button>
      }
    >
      {liveKeys.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('fleetPanel.keysEmpty')}
        </Typography>
      ) : (
        <RowList data-testid="fleet-keys">
          {liveKeys.map((key) => (
            <Row
              key={key.id}
              columns={{ xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 1fr) minmax(0, 1fr) auto' }}
            >
              <Box minWidth={0}>
                <Typography fontWeight={600} noWrap>
                  {key.name}
                  {key.locked && (
                    <Chip
                      size="small"
                      color="warning"
                      label={t('fleetPanel.keyLocked')}
                      sx={{ ml: 1 }}
                    />
                  )}
                  {key.autoLink && (
                    <Chip size="small" label={t('fleetPanel.keyAutoLink')} sx={{ ml: 1 }} />
                  )}
                  {key.skins && (
                    <Chip size="small" label={t('fleetPanel.keySkinsChip')} sx={{ ml: 1 }} />
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={mono}>
                  rfk_{key.id}_…
                </Typography>
              </Box>
              <Typography
                variant="body2"
                color="text.secondary"
                display={{ xs: 'none', md: 'block' }}
              >
                {key.maxServers
                  ? t('fleetPanel.keyUsageLimited', {
                      n: key.enrolledServers,
                      max: key.maxServers,
                    })
                  : t('fleetPanel.keyUsage', { count: key.enrolledServers })}
                {key.namePrefix
                  ? ` · ${t('fleetPanel.keyPrefix', { prefix: key.namePrefix })}`
                  : ''}
                {key.expiresAt
                  ? ` · ${t('fleetPanel.keyExpires', { time: formatWhen(key.expiresAt, locale) })}`
                  : ''}
              </Typography>
              <Tooltip title={t('fleetPanel.revokeKey')}>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => setPendingKey(key)}
                  aria-label={t('fleetPanel.revokeKey')}
                >
                  <ProhibitIcon size={20} />
                </IconButton>
              </Tooltip>
            </Row>
          ))}
        </RowList>
      )}

      {/* Create fleet key */}
      <Dialog open={keyOpen} onClose={() => setKeyOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('fleetPanel.createKey')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('fleetPanel.createKeyHelp')}
          </Typography>
          <Stack gap={2}>
            <TextField
              autoFocus
              required
              size="small"
              label={t('fleetPanel.keyName')}
              value={keyForm.name}
              onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })}
              inputProps={{ maxLength: 100 }}
            />
            <TextField
              size="small"
              label={t('fleetPanel.keyNamePrefix')}
              value={keyForm.namePrefix}
              onChange={(e) => setKeyForm({ ...keyForm, namePrefix: e.target.value })}
              inputProps={{ maxLength: 40 }}
            />
            <TextField
              size="small"
              type="number"
              label={t('fleetPanel.keyMaxServers')}
              value={keyForm.maxServers}
              onChange={(e) => setKeyForm({ ...keyForm, maxServers: e.target.value })}
              inputProps={{ min: 1 }}
            />
            <TextField
              size="small"
              type="number"
              label={t('fleetPanel.keyExpiresInDays')}
              value={keyForm.expiresInDays}
              onChange={(e) => setKeyForm({ ...keyForm, expiresInDays: e.target.value })}
              inputProps={{ min: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={keyForm.autoLink}
                  onChange={(e) => setKeyForm({ ...keyForm, autoLink: e.target.checked })}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{t('fleetPanel.keyAutoLinkLabel')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('fleetPanel.keyAutoLinkHelp')}
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={keyForm.skins}
                  onChange={(e) => setKeyForm({ ...keyForm, skins: e.target.checked })}
                  data-testid="fleet-key-skins"
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{t('fleetPanel.keySkins')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('fleetPanel.keySkinsHelp')}
                  </Typography>
                </Box>
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setKeyOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => void createKey()}
            disabled={busy || !keyForm.name.trim()}
          >
            {t('fleetPanel.createKey')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={pendingKey !== null}
        title={t('fleetPanel.confirm.revokeKeyTitle')}
        message={t('fleetPanel.confirm.revokeKeyMessage', { name: pendingKey?.name ?? '' })}
        confirmColor="error"
        loading={busy}
        onConfirm={() => void confirmRevokeKey()}
        onCancel={() => setPendingKey(null)}
      />
    </ServerSection>
  );
}
