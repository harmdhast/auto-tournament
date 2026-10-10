/**
 * What the platform pushes to one Ready Up server (FLEET.md §7.4, §7.5): the
 * last answer for each item, practice mode, its own settings, its whitelist
 * and its plugins (`cmd`), and sending its settings again.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowsClockwiseIcon,
  GearIcon,
  ListChecksIcon,
  PuzzlePieceIcon,
} from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  mono,
  useModuleTranslation,
  useSnackbar,
} from '../../../../module-sdk';
import type { FleetServer } from '../../cs2.types';
import FleetSettingsDialog from '../FleetSettingsDialog';
import { initialPluginSet } from '../FleetPushPanel';
import PluginSetPicker, { usePluginCatalog } from '../PluginSetPicker';
import type {
  FleetCommandAnswer,
  FleetPushStatus,
  FleetServerPushResponse,
  FleetSettingsResponse,
  FleetSettingsValue,
  PluginSetValue,
} from '../fleetPush.types';

const POLL_MS = 10_000;

type Dialogs = 'override' | 'whitelist' | 'plugins' | null;

const KINDS = ['admins', 'serverConfig', 'settings', 'whitelist', 'practice', 'plugins'] as const;

function StatusChip({ status, label }: { status: FleetPushStatus | null; label: string }) {
  const { t } = useModuleTranslation('cs2');
  if (!status) return null;
  let text: string;
  let color: 'default' | 'success' | 'warning' | 'error' = 'default';
  if (status.status) {
    text = t(`fleetPush.status.${status.status}`, { defaultValue: status.status });
    if (status.status === 'ok') color = 'success';
    else if (status.status === 'pending') color = 'default';
    else color = status.status === 'rejected' ? 'warning' : 'error';
  } else {
    text = status.acked
      ? t('fleetPush.status.acked', { defaultValue: 'acked' })
      : t('fleetPush.status.queued', { defaultValue: 'queued' });
    color = status.acked ? 'success' : 'default';
  }
  const detail = [status.errorCode, status.message].filter(Boolean).join(': ');
  return (
    <Tooltip title={detail || (status.rev !== null ? `rev ${status.rev}` : '')}>
      <Chip
        size="small"
        variant="outlined"
        color={color}
        label={`${label}: ${text}`}
        sx={{ mr: 0.5, mb: 0.5 }}
      />
    </Tooltip>
  );
}

export function FleetServerPushSection({ server }: { server: FleetServer }) {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const [push, setPush] = useState<FleetServerPushResponse | null>(null);
  const [defaults, setDefaults] = useState<FleetSettingsResponse | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [whitelistEnabled, setWhitelistEnabled] = useState(true);
  const [pluginSet, setPluginSet] = useState<PluginSetValue | null>(null);
  const { catalog } = usePluginCatalog();
  const id = server.id;

  const load = useCallback(async () => {
    const [p, d] = await Promise.all([
      api.get<FleetServerPushResponse>(`/api/fleet/servers/${id}/push`).catch(() => null),
      api.get<FleetSettingsResponse>('/api/fleet/settings').catch(() => null),
    ]);
    if (p) setPush(p);
    if (d) setDefaults(d);
  }, [id]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, what));
    } finally {
      setBusy(false);
    }
  };

  const answered = (res: FleetCommandAnswer, okText: string) => {
    const c = res.command;
    if (c.status === 'ok') showSnackbar(okText, 'success');
    else if (c.status === 'pending')
      showSnackbar(
        c.delivered
          ? t('fleetPush.sentNoAnswer', { defaultValue: 'Sent; no answer yet' })
          : t('fleetPush.queuedOffline', {
              defaultValue: 'Queued: the server gets it when it reconnects',
            }),
        'info'
      );
    else showError(`${c.errorCode ?? c.status}${c.message ? `: ${c.message}` : ''}`);
  };

  const saveOverride = (value: FleetSettingsValue | null) =>
    run(t('fleetPush.errors.save', { defaultValue: 'Saving the settings failed' }), async () => {
      await api.put(`/api/fleet/servers/${id}/settings`, { settings: value });
      showSnackbar(
        t('fleetPush.savedServer', {
          name: server.name,
          defaultValue: 'Saved and pushed to {{name}}',
        }),
        'success'
      );
      setDialog(null);
    });

  const pushSettingsNow = () =>
    run(t('fleetPush.errors.push', { defaultValue: 'Push failed' }), async () => {
      await api.post(`/api/fleet/servers/${id}/settings/push`);
      showSnackbar(t('fleetPush.pushed', { defaultValue: 'Pushed' }), 'success');
    });

  const setPractice = (on: boolean) =>
    run(
      t('fleetPush.errors.practice', { defaultValue: 'Switching practice mode failed' }),
      async () => {
        const res = await api.put<FleetCommandAnswer>(`/api/fleet/servers/${id}/practice`, { on });
        answered(
          res,
          on
            ? t('fleetPush.practiceOn', { defaultValue: 'Practice mode on' })
            : t('fleetPush.practiceOff', { defaultValue: 'Practice mode off' })
        );
      }
    );

  const saveWhitelist = () =>
    run(
      t('fleetPush.errors.whitelist', { defaultValue: 'Setting the whitelist failed' }),
      async () => {
        const ids = text
          .split(/[\s,;]+/)
          .map((x) => x.trim())
          .filter(Boolean);
        const res = await api.put<FleetCommandAnswer>(`/api/fleet/servers/${id}/whitelist`, {
          enabled: whitelistEnabled,
          steamids: ids,
        });
        answered(res, t('fleetPush.whitelistSet', { defaultValue: 'Whitelist updated' }));
        setDialog(null);
      }
    );

  const savePlugins = () =>
    run(
      t('fleetPush.errors.plugins', { defaultValue: 'Changing the plugins failed' }),
      async () => {
        if (!pluginSet) return;
        const res = await api.post<FleetCommandAnswer>(`/api/fleet/servers/${id}/plugins`, {
          preset: pluginSet.preset,
          plugins: pluginSet.plugins,
        });
        answered(res, t('fleetPush.pluginsSet', { defaultValue: 'Plugins updated' }));
        setDialog(null);
      }
    );

  const openWhitelist = () => {
    setWhitelistEnabled(push?.whitelist?.enabled ?? true);
    setText((push?.whitelist?.steamids ?? []).join('\n'));
    setDialog('whitelist');
  };

  const openPlugins = () => {
    if (!catalog) return;
    setPluginSet(initialPluginSet(catalog, push?.pluginSet, push?.pluginsState));
    setDialog('plugins');
  };

  const problems = KINDS.map((k) => push?.pushed[k]).filter(
    (p): p is FleetPushStatus =>
      !!p && (p.status === 'rejected' || p.status === 'failed' || p.status === 'expired')
  );

  return (
    <Box data-testid="server-panel-push" sx={{ display: 'grid', gap: 1.5 }}>
      <Typography variant="body2" color="text.secondary" sx={mono}>
        {push?.override
          ? t('fleetPush.hasOverride', { defaultValue: 'Own settings' })
          : t('fleetPush.usesDefault', { defaultValue: 'Fleet default settings' })}
        {push?.pluginSet
          ? ` · ${t(`pluginSets.preset.${push.pluginSet.preset}`, { defaultValue: push.pluginSet.preset })}`
          : ''}
      </Typography>
      {push && (
        <Box>
          {KINDS.map((k) => (
            <StatusChip
              key={k}
              status={push.pushed[k] ?? null}
              label={t(`fleetPush.kind.${k}`, { defaultValue: k })}
            />
          ))}
        </Box>
      )}
      {problems.map((p, i) => (
        <Typography key={i} variant="caption" color="error" data-testid="server-panel-push-error">
          {[p.errorCode, p.message].filter(Boolean).join(': ') ||
            t(`fleetPush.status.${p.status}`, { defaultValue: p.status ?? '' })}
        </Typography>
      ))}
      <FormControlLabel
        sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '0.875rem' } }}
        control={
          <Switch
            size="small"
            checked={push?.practice === true}
            disabled={busy || !push}
            onChange={(e) => void setPractice(e.target.checked)}
            inputProps={{ 'aria-label': t('fleetPush.practice', { defaultValue: 'Practice' }) }}
            data-testid={`fleet-practice-${id}`}
          />
        }
        label={t('fleetPush.practice', { defaultValue: 'Practice' })}
      />
      <Stack direction="row" gap={0.5} flexWrap="wrap">
        <Button size="small" startIcon={<GearIcon />} onClick={() => setDialog('override')}>
          {t('fleetPush.settings', { defaultValue: 'Settings' })}
        </Button>
        <Button size="small" startIcon={<ListChecksIcon />} onClick={openWhitelist}>
          {t('fleetPush.whitelist', { defaultValue: 'Whitelist' })}
        </Button>
        <Button
          size="small"
          startIcon={<PuzzlePieceIcon />}
          onClick={openPlugins}
          disabled={!catalog}
        >
          {t('fleetPush.plugins', { defaultValue: 'Plugins' })}
        </Button>
        <Button
          size="small"
          startIcon={<ArrowsClockwiseIcon />}
          onClick={() => void pushSettingsNow()}
          disabled={busy}
        >
          {t('fleetPush.pushAgain', { defaultValue: 'Push again' })}
        </Button>
      </Stack>

      <FleetSettingsDialog
        open={dialog === 'override'}
        title={t('fleetPush.serverSettingsTitle', {
          name: server.name,
          defaultValue: 'Settings: {{name}}',
        })}
        inherited={defaults?.settings ?? null}
        initial={push?.override ?? null}
        saving={busy}
        onClose={() => setDialog(null)}
        onSave={(v) => void saveOverride(v)}
        onClear={() => void saveOverride(null)}
      />

      <Dialog open={dialog === 'whitelist'} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {t('fleetPush.whitelistTitle', {
            name: server.name,
            defaultValue: 'Whitelist: {{name}}',
          })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('fleetPush.whitelistHelp', {
              defaultValue:
                'Replaces the whitelist plugin\'s list and switch on this server (whitelist.set). One SteamID64 per line; at most 1000. Servers without the whitelist plugin answer "unsupported".',
            })}
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={whitelistEnabled}
                onChange={(e) => setWhitelistEnabled(e.target.checked)}
              />
            }
            label={t('fleetPush.whitelistEnabled', { defaultValue: 'Whitelist on' })}
          />
          <TextField
            fullWidth
            multiline
            minRows={6}
            size="small"
            sx={{ mt: 1, ...mono }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="76561198000000000"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" disabled={busy} onClick={() => void saveWhitelist()}>
            {t('fleetPush.send', { defaultValue: 'Send' })}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'plugins'} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {t('fleetPush.pluginsTitle', { name: server.name, defaultValue: 'Plugins: {{name}}' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('pluginSets.serverHelp', {
              defaultValue:
                'Turns Ready Up plugins on or off on this server (plugins.set). The server keeps the choice after a restart, and gets it again if it reconnects with other plugins on.',
            })}
          </Typography>
          {catalog && pluginSet && (
            <PluginSetPicker
              catalog={catalog}
              value={pluginSet}
              onChange={setPluginSet}
              installed={push?.pluginsState?.installed ?? null}
              disabled={busy}
              testId="server-plugins"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" disabled={busy} onClick={() => void savePlugins()}>
            {t('fleetPush.send', { defaultValue: 'Send' })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
