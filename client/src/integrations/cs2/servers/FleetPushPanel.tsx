/**
 * The Servers page's Push tab: what the platform pushes to every Ready Up
 * server outside a match (FLEET.md §7.4, §7.5).
 *
 * - In-game admins (`admins.set`): the website's admins plus extra in-game
 *   admins, one fleet-wide list with a rev.
 * - Fleet default settings (`server.config` + `settings.set`).
 * - Default plugins: the set servers csm creates start with.
 *
 * What goes to one server (its own settings, whitelist, practice, plugins)
 * is in that server's panel (list/FleetServerPushSection.tsx).
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
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowsClockwiseIcon, GearIcon, PuzzlePieceIcon, UsersIcon } from '@phosphor-icons/react';
import { api, apiErrorMessage, mono, useModuleTranslation, useSnackbar } from '../../../module-sdk';
import { ServerSection } from './ServerSection';
import FleetSettingsDialog from './FleetSettingsDialog';
import PluginSetPicker, { presetValue, usePluginCatalog } from './PluginSetPicker';
import type {
  FleetAdminsResponse,
  FleetSettingsResponse,
  FleetSettingsValue,
  PluginCatalogResponse,
  PluginSetValue,
  PluginsState,
} from './fleetPush.types';
import { useTopic } from '../../../module-sdk';

type Dialogs = { kind: 'defaults' } | { kind: 'extras' } | { kind: 'defaultPlugins' } | null;

/** "steamid64 name" per line → entries; bad lines are reported. */
export function parseAdminLines(text: string): {
  admins: { steamid64: string; name: string }[];
  bad: string[];
} {
  const admins: { steamid64: string; name: string }[] = [];
  const bad: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^(\d{17})(?:[\s,;]+(.*))?$/.exec(trimmed);
    if (!m) bad.push(trimmed);
    else admins.push({ steamid64: m[1], name: (m[2] ?? '').trim() });
  }
  return { admins, bad };
}

/**
 * The set a server's Plugins dialog starts from: the set it was given, else
 * what its hello says is on, else the fleet default, else Tournament.
 */
export function initialPluginSet(
  catalog: PluginCatalogResponse,
  given: PluginSetValue | null | undefined,
  state: PluginsState | null | undefined
): PluginSetValue {
  if (given) return given;
  if (state) {
    const on = catalog.catalog.filter(
      (p) =>
        catalog.required.includes(p) || (state.installed.includes(p) && !state.disabled.includes(p))
    );
    const preset = (['tournament', 'practice', 'fun', 'tryout', 'movement'] as const).find(
      (x) =>
        catalog.presets[x].length === on.length && catalog.presets[x].every((p) => on.includes(p))
    );
    return { preset: preset ?? 'custom', plugins: on };
  }
  return catalog.default ?? presetValue(catalog, 'tournament');
}

export default function FleetPushPanel() {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const [admins, setAdmins] = useState<FleetAdminsResponse | null>(null);
  const [defaults, setDefaults] = useState<FleetSettingsResponse | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [pluginSet, setPluginSet] = useState<PluginSetValue | null>(null);
  const { catalog, reload: reloadCatalog } = usePluginCatalog();

  const load = useCallback(async () => {
    try {
      const [a, d] = await Promise.all([
        api.get<FleetAdminsResponse>('/api/fleet/admins'),
        api.get<FleetSettingsResponse>('/api/fleet/settings'),
      ]);
      setAdmins(a);
      setDefaults(d);
    } catch (err) {
      console.error('Failed to load the fleet settings', err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  // Re-read when the fleet changes (the `fleet` topic), not on a timer.
  useTopic('fleet', load, { admin: true });

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

  const saveDefaults = (value: FleetSettingsValue) =>
    run(t('fleetPush.errors.save', { defaultValue: 'Saving the settings failed' }), async () => {
      const res = await api.put<{ rev: number; pushed: number }>('/api/fleet/settings', {
        settings: value,
      });
      showSnackbar(
        t('fleetPush.savedDefaults', {
          count: res.pushed,
          defaultValue: 'Saved; pushed to {{count}} server(s)',
        }),
        'success'
      );
      setDialog(null);
    });

  const saveDefaultPlugins = () =>
    run(
      t('pluginSets.errors.save', { defaultValue: 'Saving the default plugins failed' }),
      async () => {
        await api.put('/api/fleet/plugins/default', {
          plugins: pluginSet ? { preset: pluginSet.preset, plugins: pluginSet.plugins } : null,
        });
        await reloadCatalog();
        showSnackbar(t('pluginSets.saved', { defaultValue: 'Default plugins saved' }), 'success');
        setDialog(null);
      }
    );

  const saveExtras = () =>
    run(t('fleetPush.errors.admins', { defaultValue: 'Saving the admins failed' }), async () => {
      const parsed = parseAdminLines(text);
      if (parsed.bad.length > 0)
        throw new Error(
          t('fleetPush.badAdminLine', {
            line: parsed.bad[0],
            defaultValue: 'Not "SteamID64 name": {{line}}',
          })
        );
      const res = await api.put<{ rev: number; changed: boolean }>('/api/fleet/admins/extras', {
        admins: parsed.admins,
      });
      showSnackbar(
        res.changed
          ? t('fleetPush.adminsPushed', {
              rev: res.rev,
              defaultValue: 'Admin list rev {{rev}} pushed',
            })
          : t('fleetPush.adminsUnchanged', { defaultValue: 'The admin list did not change' }),
        'success'
      );
      setDialog(null);
    });

  const pushAdminsNow = () =>
    run(t('fleetPush.errors.push', { defaultValue: 'Push failed' }), async () => {
      const res = await api.post<{ pushed: number }>('/api/fleet/admins/push');
      showSnackbar(
        t('fleetPush.adminsPushedTo', {
          count: res.pushed,
          defaultValue: 'Sent to {{count}} server(s)',
        }),
        'success'
      );
    });

  const openDefaultPlugins = () => {
    setPluginSet(catalog?.default ?? null);
    setDialog({ kind: 'defaultPlugins' });
  };

  const openExtras = () => {
    setText((admins?.extras ?? []).map((a) => `${a.steamid64} ${a.name}`).join('\n'));
    setDialog({ kind: 'extras' });
  };

  if (!admins) return null;

  const extrasSet = new Set((admins?.extras ?? []).map((a) => a.steamid64));

  return (
    <ServerSection
      id="fleet-settings"
      data-testid="fleet-push-panel"
      summary={t('fleetPush.summary', {
        defaultValue: 'Admins, settings and plugins sent to Ready Up servers',
      })}
      title={t('fleetPush.title', { defaultValue: 'Fleet settings' })}
      action={
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button
            size="small"
            variant="outlined"
            startIcon={<PuzzlePieceIcon />}
            onClick={openDefaultPlugins}
            disabled={!catalog}
            data-testid="fleet-default-plugins-edit"
          >
            {t('pluginSets.defaultButton', { defaultValue: 'Default plugins' })}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<GearIcon />}
            onClick={() => setDialog({ kind: 'defaults' })}
            data-testid="fleet-defaults-edit"
          >
            {t('fleetPush.editDefaults', { defaultValue: 'Fleet default settings' })}
          </Button>
        </Stack>
      }
    >
      {/* In-game admins (admins.set) */}
      <Box mb={3}>
        <Stack direction="row" alignItems="center" gap={1} mb={1} flexWrap="wrap">
          <UsersIcon size={18} />
          <Typography variant="subtitle2" fontWeight={600}>
            {t('fleetPush.adminsTitle', { defaultValue: 'In-game admins' })}
          </Typography>
          {admins && (
            <Chip
              size="small"
              label={t('fleetPush.adminsRev', {
                rev: admins.rev,
                count: admins.admins.length,
                defaultValue: 'rev {{rev}} · {{count}} admin(s)',
              })}
            />
          )}
          <Box flex={1} />
          <Button size="small" onClick={openExtras}>
            {t('fleetPush.editExtras', { defaultValue: 'Extra in-game admins' })}
          </Button>
          <Button
            size="small"
            startIcon={<ArrowsClockwiseIcon />}
            onClick={() => void pushAdminsNow()}
            disabled={busy || !admins || admins.rev < 1}
          >
            {t('fleetPush.pushAgain', { defaultValue: 'Push again' })}
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" mb={1}>
          {t('fleetPush.adminsHelp', {
            defaultValue:
              'Website admins with a Steam account, plus the extra in-game admins. Every Ready Up server gets this list when it changes and when it reconnects with an older one.',
          })}
        </Typography>
        <Box>
          {(admins?.admins ?? []).map((a) => (
            <Chip
              key={a.steamid64}
              size="small"
              variant={extrasSet.has(a.steamid64) ? 'outlined' : 'filled'}
              label={a.name}
              title={a.steamid64}
              sx={{ mr: 0.5, mb: 0.5 }}
            />
          ))}
        </Box>
      </Box>

      <FleetSettingsDialog
        open={dialog?.kind === 'defaults'}
        title={t('fleetPush.editDefaults', { defaultValue: 'Fleet default settings' })}
        initial={defaults?.settings ?? null}
        saving={busy}
        onClose={() => setDialog(null)}
        onSave={(v) => void saveDefaults(v)}
      />
      {/* Default plugins for new servers */}
      <Dialog
        open={dialog?.kind === 'defaultPlugins'}
        onClose={() => setDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {t('pluginSets.defaultTitle', { defaultValue: 'Default plugins for new servers' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('pluginSets.defaultHelp', {
              defaultValue:
                'Servers created on a machine, by automatic scaling or for a failover get these plugins when they first connect, unless they were created with their own choice. Servers that already exist keep theirs.',
            })}
          </Typography>
          {catalog && (
            <PluginSetPicker
              catalog={{ ...catalog, default: null }}
              value={pluginSet}
              onChange={setPluginSet}
              nullLabel={t('pluginSets.preset.none', { defaultValue: 'None' })}
              disabled={busy}
              testId="default-plugins"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={busy || !catalog}
            onClick={() => void saveDefaultPlugins()}
            data-testid="default-plugins-save"
          >
            {t('pluginSets.save', { defaultValue: 'Save' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Extra in-game admins */}
      <Dialog
        open={dialog?.kind === 'extras'}
        onClose={() => setDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {t('fleetPush.editExtras', { defaultValue: 'Extra in-game admins' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('fleetPush.extrasHelp', {
              defaultValue:
                'In-game admins who are not website admins (referees, casters). One per line: SteamID64, then a name.',
            })}
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={6}
            size="small"
            sx={mono}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="76561198000000000 Referee"
            inputProps={{ 'data-testid': 'fleet-extra-admins' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" disabled={busy} onClick={() => void saveExtras()}>
            {t('fleetPush.saveAndPush', { defaultValue: 'Save and push' })}
          </Button>
        </DialogActions>
      </Dialog>
    </ServerSection>
  );
}
