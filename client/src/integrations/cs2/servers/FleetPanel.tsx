/**
 * The Servers page's "Ready Up fleet" area (FLEET.md §4, platform step 1).
 *
 * Ready Up servers do not get added by address and RCON password: they enroll
 * themselves with a one-time code (Add server) or a reusable fleet key
 * (csm, containers), then hold a WebSocket to `/api/fleet/ws`. This lists
 * them with their online state and versions, and lets an admin create codes
 * and keys (each shown once), rotate a token, revoke a server, and revoke keys.
 * "Use for matches" links an enrolled server to a server row so the
 * allocator hands it matches (`POST /api/fleet/servers/:id/link`), optionally
 * with a connect address set by hand; otherwise players connect to the address
 * the server reports (`public_addr`) or the one its link comes from
 * (`PUT /api/fleet/servers/:id/address` changes it later).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  ButtonBase,
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
import {
  KeyIcon,
  PlusIcon,
  ProhibitIcon,
} from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  ConfirmDialog,
  mono,
  Row,
  RowList,
  StatusDot,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import { isGuessedAddress } from './list/serverGroups';
import { useFleetServerActions } from './list/useFleetServerActions';
import type { FleetKey, FleetKeysResponse, FleetServer, FleetServersResponse } from '../cs2.types';
import { ServerSection } from './ServerSection';
import { AvailabilityChip, AvailabilityReason } from './fleet/readyup/AvailabilityChip';
import { ResetServerButton } from './fleet/readyup/ResetServerButton';

const POLL_MS = 10_000;

function when(unixSeconds: number | null | undefined, locale: string): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString(locale);
}

function statusDot(server: FleetServer): 'live' | 'free' | 'loading' | 'error' {
  if (server.status === 'revoked') return 'error';
  if (server.status === 'pending') return 'loading';
  return server.online ? 'live' : 'free';
}

/** `servers` / `keys`: one half, for the Ready Up fleet section's tabs; `all`: both. */
export type FleetPanelPart = 'all' | 'servers' | 'keys';

export default function FleetPanel({
  part = 'all',
  onOpenServer,
}: { part?: FleetPanelPart; onOpenServer?: (id: string) => void } = {}) {
  const { t, i18n } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [servers, setServers] = useState<FleetServer[]>([]);
  const [keys, setKeys] = useState<FleetKey[]>([]);
  const [loaded, setLoaded] = useState(false);
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
      const [s, k] = await Promise.all([
        api.get<FleetServersResponse>('/api/fleet/servers'),
        api.get<FleetKeysResponse>('/api/fleet/keys'),
      ]);
      setServers(s.servers || []);
      setKeys(k.keys || []);
    } catch (err) {
      console.error('Failed to load the fleet', err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const { actionsFor, addServer, showSecret, sourceLabel, dialogs } = useFleetServerActions(load);

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
      id={part === 'keys' ? 'fleet-keys' : 'fleet'}
      data-testid="fleet-panel"
      title={t('fleetPanel.title')}
      summary={t('fleetPanel.summary', {
        defaultValue: '{{servers}} Ready Up server(s), {{online}} online · {{keys}} fleet key(s)',
        servers: servers.length,
        online: servers.filter((sv) => sv.online).length,
        keys: liveKeys.length,
      })}
      about={t('fleetPanel.description')}
      action={
        part !== 'servers' && (
          <Stack direction="row" gap={1}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<KeyIcon />}
              onClick={() => setKeyOpen(true)}
            >
              {t('fleetPanel.createKey')}
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<PlusIcon />}
              onClick={addServer}
              data-testid="fleet-add-server"
            >
              {t('fleetPanel.addServer')}
            </Button>
          </Stack>
        )
      }
    >
      {part !== 'keys' &&
        (loaded && servers.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="fleet-empty">
            {t('fleetPanel.empty')}
          </Typography>
        ) : (
          <RowList data-testid="fleet-servers">
            {servers.map((server) => (
              <Row
                key={server.id}
                columns={{
                  xs: 'auto minmax(0, 1fr)',
                  md: 'auto minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto',
                }}
                data-testid={`fleet-server-${server.id}`}
              >
                <StatusDot state={statusDot(server)} />
                <Box minWidth={0}>
                  <Stack direction="row" alignItems="center" gap={1} minWidth={0}>
                    {onOpenServer ? (
                      <ButtonBase
                        onClick={() => onOpenServer(server.id)}
                        data-testid={`fleet-open-${server.id}`}
                        sx={{
                          minWidth: 0,
                          borderRadius: 1,
                          textDecoration: 'underline',
                          textUnderlineOffset: 3,
                        }}
                      >
                        <Typography fontWeight={600} noWrap>
                          {server.name}
                        </Typography>
                      </ButtonBase>
                    ) : (
                      <Typography fontWeight={600} noWrap>
                        {server.name}
                      </Typography>
                    )}
                    {server.status === 'enrolled' && <AvailabilityChip server={server} />}
                  </Stack>
                  <AvailabilityReason server={server} />
                  {server.connect ? (
                    <Tooltip title={sourceLabel(server.connect)}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={mono}
                        noWrap
                        display="block"
                        data-testid={`fleet-connect-${server.id}`}
                      >
                        {`connect ${server.connect.address}`}
                        {server.connect.source === 'override' ? ' *' : ''}
                      </Typography>
                    </Tooltip>
                  ) : (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={mono}
                      noWrap
                      display="block"
                    >
                      {server.host ? `${server.host.hostname}:${server.host.game_port}` : server.id}
                    </Typography>
                  )}
                  {isGuessedAddress(server) && (
                    <Typography
                      variant="caption"
                      color="warning.main"
                      display="block"
                      data-testid={`fleet-connect-guessed-${server.id}`}
                    >
                      {t('fleetPanel.connectGuessed', {
                        defaultValue:
                          'Guessed from where the server connects from. Check it, or set the address players use.',
                      })}
                    </Typography>
                  )}
                </Box>
                <Box minWidth={0} display={{ xs: 'none', md: 'block' }}>
                  <Chip
                    size="small"
                    label={t(
                      `fleetPanel.status.${server.status === 'enrolled' ? (server.online ? 'online' : 'offline') : server.status}`
                    )}
                    color={
                      server.status === 'revoked' ? 'error' : server.online ? 'success' : 'default'
                    }
                    variant={server.online ? 'filled' : 'outlined'}
                  />
                  {server.status === 'pending' && server.codeExpiresAt && (
                    <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                      {t('fleetPanel.codeExpires', { time: when(server.codeExpiresAt, locale) })}
                    </Typography>
                  )}
                  {server.status === 'enrolled' && !server.online && server.lastSeen !== null && (
                    <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                      {t('fleetPanel.lastSeen', { time: when(server.lastSeen, locale) })}
                    </Typography>
                  )}
                </Box>
                <Box minWidth={0} display={{ xs: 'none', md: 'block' }}>
                  {server.versions ? (
                    <>
                      <Typography variant="body2" sx={mono} noWrap>
                        {t('fleetPanel.readyUpVersion', { version: server.versions.core })}
                      </Typography>
                      {server.readyUpUpdate?.state === 'outdated' ? (
                        <Typography variant="caption" color="warning.main" display="block">
                          {t('fleetPanel.updateAvailable', {
                            version: server.readyUpUpdate.latest,
                            defaultValue: 'Update available: {{version}}',
                          })}
                        </Typography>
                      ) : server.readyUpUpdate?.state === 'current' ? (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {t('fleetPanel.upToDate', { defaultValue: 'Up to date' })}
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {t('fleetPanel.noUpdateCheck', { defaultValue: 'No update check yet' })}
                        </Typography>
                      )}
                      {server.versions.cs2_build !== undefined && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={mono}
                          display="block"
                        >
                          {t('fleetPanel.cs2Build', { build: server.versions.cs2_build })}
                        </Typography>
                      )}
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      —
                    </Typography>
                  )}
                </Box>
                <Stack
                  direction="row"
                  gap={0.5}
                  justifyContent="flex-end"
                  gridColumn={{ xs: '1 / -1', md: 'auto' }}
                >
                  {actionsFor(server).map((action) => (
                    <Tooltip key={action.id} title={action.label}>
                      <IconButton
                        size="small"
                        color={action.danger ? 'error' : 'default'}
                        onClick={action.run}
                        aria-label={action.label}
                        data-testid={action.testId}
                      >
                        {action.icon}
                      </IconButton>
                    </Tooltip>
                  ))}
                  {server.status === 'enrolled' && (
                    <ResetServerButton server={server} onDone={() => void load()} />
                  )}
                </Stack>
              </Row>
            ))}
          </RowList>
        ))}

      {part !== 'servers' && (
        <>
          <Typography variant="subtitle2" fontWeight={600} mt={part === 'keys' ? 0 : 3} mb={1}>
            {t('fleetPanel.keysTitle')}
          </Typography>
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
                      ? ` · ${t('fleetPanel.keyExpires', { time: when(key.expiresAt, locale) })}`
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
        </>
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
      {dialogs}
    </ServerSection>
  );
}
