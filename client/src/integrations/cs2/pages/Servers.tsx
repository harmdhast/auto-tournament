/**
 * Servers: every server on one list, grouped by the csm machine that runs it
 * (Ready Up servers on no machine), and the
 * fleet-wide settings as tabs (keys, push, automatic scaling, failover).
 *
 * A machine is linked with one command; every server on it is created,
 * started, stopped, restarted, updated and deleted from here. A server's
 * details and actions open in one side panel (`?server=<row key>`). Whatever
 * is asked of csm shows at once and follows csm's progress over the socket.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Menu, MenuItem, Tab, Tabs, Typography } from '@mui/material';
import { CaretDownIcon, PlusIcon } from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  ConfirmDialog,
  PageHead,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import type { FleetHost } from '../cs2.types';
import { insecureFlag } from '../servers/insecureLink';
import { serverLimitText, useServerLimit } from '../servers/serverLimit';
import { useFleet } from '../servers/fleet/useFleet';
import { useServerMatches } from '../servers/fleet/useServerMatches';
import { MachineSheet } from '../servers/fleet/MachineSheet';
import { FirstMachine } from '../servers/fleet/FirstMachine';
import AutoScalePanel from '../servers/AutoScalePanel';
import FleetPanel from '../servers/FleetPanel';
import FleetPushPanel from '../servers/FleetPushPanel';
import FailoverSettingsPanel from '../servers/FailoverSettingsPanel';
import { EmbeddedServerSections } from '../servers/ServerSection';
import { OPEN_EVENT } from '../servers/openServerSection';
import { ServerList } from '../servers/list/ServerList';
import { ServerPanel } from '../servers/list/ServerPanel';
import { buildServerGroups, rowForFleetServer } from '../servers/list/serverGroups';
import { useFleetServerActions } from '../servers/list/useFleetServerActions';
import { useServerSources } from '../servers/list/useServerSources';
import {
  AddMachineDialog,
  AddServersDialog,
  ForceDialog,
  LinkDialog,
  ReadyUpDialog,
  type LinkInfo,
} from '../servers/fleet/FleetDialogs';

type ServersTab = 'servers' | 'keys' | 'push' | 'autoscale' | 'failover';
const TABS: ServersTab[] = ['servers', 'keys', 'push', 'autoscale', 'failover'];

/** The anchors other pages and buttons link to, and the tab each one shows. */
const ANCHOR_TAB: Record<string, ServersTab> = {
  fleet: 'servers',
  'fleet-keys': 'keys',
  'fleet-settings': 'push',
  autoscale: 'autoscale',
  failover: 'failover',
};

function tabFromHash(): ServersTab | null {
  return ANCHOR_TAB[window.location.hash.slice(1)] ?? null;
}

export default function Servers() {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const fleet = useFleet();
  const { hosts, loaded } = fleet;
  const matches = useServerMatches();
  const limit = useServerLimit();
  const [params, setParams] = useSearchParams();
  const sources = useServerSources();
  const { actionsFor, addServer, showSecret, sourceLabel, dialogs } = useFleetServerActions(
    sources.reload
  );
  const groups = useMemo(
    () => buildServerGroups(hosts, sources.fleetServers),
    [hosts, sources.fleetServers]
  );
  const [tab, setTab] = useState<ServersTab>(() => tabFromHash() ?? 'servers');
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);

  // A machine's panel is `?machine=<id>` (links from elsewhere open it); a server's is local.
  const machineId = params.get('machine');
  const openMachine = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('machine', id);
      else next.delete('machine');
      return next;
    });
  // A server's panel is `?server=<row key>`; the older `?fleetServer=<id>` is turned into it.
  const serverKey = params.get('server');
  const openServer = (key: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (key) next.set('server', key);
      else next.delete('server');
      return next;
    });
  const legacyFleetId = params.get('fleetServer');
  const ready = loaded && sources.loaded;
  useEffect(() => {
    if (!legacyFleetId || !ready) return;
    const key = rowForFleetServer(groups, legacyFleetId)?.key ?? `r:${legacyFleetId}`;
    // Replace: Back must not land on the old link and be sent forward again.
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('fleetServer');
        next.set('server', key);
        return next;
      },
      { replace: true }
    );
  }, [legacyFleetId, ready, groups, setParams]);
  const panelRow = serverKey
    ? (groups.flatMap((g) => g.rows).find((r) => r.key === serverKey) ?? null)
    : null;

  useEffect(() => {
    const onHash = () => {
      const next = tabFromHash();
      if (next) setTab(next);
    };
    const onOpen = (e: Event) => {
      const next = ANCHOR_TAB[(e as CustomEvent<string>).detail];
      if (next) setTab(next);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const [menu, setMenu] = useState<{ host: FleetHost; anchor: HTMLElement } | null>(null);
  const [addServersFor, setAddServersFor] = useState<FleetHost | null>(null);
  const [readyUpFor, setReadyUpFor] = useState<FleetHost | null>(null);
  const [deleteServer, setDeleteServer] = useState<{ host: FleetHost; server: string } | null>(
    null
  );
  const [pending, setPending] = useState<{ action: 'revoke' | 'remove'; host: FleetHost } | null>(
    null
  );
  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [link, setLink] = useState<LinkInfo | null>(null);
  const [linkInline, setLinkInline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [licenseMax, setLicenseMax] = useState<number | null>(null);
  useEffect(() => {
    api
      .get<{ license?: { maxServers?: number; kind?: string } | null }>('/api/license')
      // A free key has no server limit.
      .then((res) =>
        setLicenseMax(
          res?.license?.kind !== 'free' && typeof res?.license?.maxServers === 'number'
            ? res.license.maxServers
            : null
        )
      )
      .catch(() => setLicenseMax(null));
  }, []);

  const linkCommand = (code: string) =>
    `csm link ${window.location.origin} ${code}${insecureFlag()}`;

  const addMachine = useCallback(
    async (name: string, inline: boolean) => {
      setBusy(true);
      try {
        const res = await api.post<{ host: FleetHost; code: string; expiresAt: number }>(
          '/api/fleet/hosts',
          name ? { name } : {}
        );
        setAddMachineOpen(false);
        setLinkInline(inline);
        setLink({
          hostId: res.host.id,
          name: res.host.name,
          command: linkCommand(res.code),
          expiresAt: res.expiresAt,
        });
        await fleet.load();
      } catch (err) {
        showError(
          apiErrorMessage(
            err,
            t('machinesPanel.errors.add', { defaultValue: 'Could not add the machine' })
          )
        );
      } finally {
        setBusy(false);
      }
    },
    [fleet, showError, t]
  );

  const newCode = async (host: FleetHost) => {
    try {
      const res = await api.post<{ code: string; expiresAt: number }>(
        `/api/fleet/hosts/${host.id}/code`
      );
      setLinkInline(false);
      setLink({
        hostId: host.id,
        name: host.name,
        command: linkCommand(res.code),
        expiresAt: res.expiresAt,
      });
    } catch (err) {
      showError(
        apiErrorMessage(
          err,
          t('machinesPanel.errors.add', { defaultValue: 'Could not add the machine' })
        )
      );
    }
  };

  const rotate = async (host: FleetHost) => {
    try {
      const res = await api.post<{ rotation: 'sent' | 'on_next_connect' }>(
        `/api/fleet/hosts/${host.id}/rotate`
      );
      showSnackbar(
        res.rotation === 'sent'
          ? t('machinesPanel.rotateSent', { defaultValue: 'New token sent' })
          : t('machinesPanel.rotateQueued', {
              defaultValue: 'The machine gets a new token when it next connects',
            }),
        'success'
      );
      await fleet.load();
    } catch (err) {
      showError(
        apiErrorMessage(
          err,
          t('machinesPanel.errors.command', { defaultValue: 'The command failed' })
        )
      );
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.action === 'revoke') await api.post(`/api/fleet/hosts/${pending.host.id}/revoke`);
      else await api.delete(`/api/fleet/hosts/${pending.host.id}`);
      if (machineId === pending.host.id) openMachine(null);
      await fleet.load();
    } catch (err) {
      showError(
        apiErrorMessage(
          err,
          t('machinesPanel.errors.command', { defaultValue: 'The command failed' })
        )
      );
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  // The first machine's guide stays up from "Get the command" until csm
  // connects: the code adds the (not yet linked) machine to the list.
  const firstSetup =
    ready &&
    ((hosts.length === 0 && groups.length === 0) ||
      (linkInline &&
        link !== null &&
        hosts.length === 1 &&
        hosts[0].id === link.hostId &&
        !hosts[0].online));
  const linked = link ? hosts.find((h) => h.id === link.hostId) : undefined;
  const linkConnected = !!linked && linked.status === 'enrolled' && linked.online;

  // The servers that count: revoked or not yet enrolled Ready Up records do not.
  const total = groups.reduce(
    (n, g) =>
      n +
      g.rows.filter((r) => (r.kind === 'readyup' ? r.fleet.status === 'enrolled' : true)).length,
    0
  );
  const machineHost = machineId ? (hosts.find((h) => h.id === machineId) ?? null) : null;

  return (
    <Box
      data-testid="servers-page"
      sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}
    >
      <PageHead
        title={t('serversPage.title')}
        subtitle={
          <span data-testid="servers-limit">
            {t('serversPage.machineCount', { count: hosts.length })}
            {' · '}
            {t('serversPage.fleet.total', { count: total })}
            {limit &&
              (() => {
                const line = serverLimitText(limit, total);
                return ` · ${t(line.key, line.values)}`;
              })()}
          </span>
        }
        actions={
          <Button
            variant="contained"
            startIcon={<PlusIcon />}
            endIcon={<CaretDownIcon size={14} />}
            onClick={(e) => setAddMenu(e.currentTarget)}
            data-testid="servers-add"
          >
            {t('serversPage.add.button', { defaultValue: 'Add' })}
          </Button>
        }
      />

      <Tabs
        value={tab}
        onChange={(_e, value: ServersTab) => setTab(value)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{
          // The page head ends with a wide margin; the tabs belong to it.
          mt: -4,
          borderBottom: 1,
          borderColor: 'divider',
          minHeight: 40,
          '& .MuiTab-root': { px: 2, minWidth: 0, minHeight: 40 },
        }}
      >
        {TABS.map((id) => (
          <Tab
            key={id}
            value={id}
            label={t(`serversBoard.readyUp.tabs.${id}`)}
            data-testid={`servers-tab-${id}`}
          />
        ))}
      </Tabs>

      {tab === 'servers' && (
        <>
          {firstSetup ? (
            <FirstMachine
              link={linkInline ? link : null}
              busy={busy}
              onCreate={(name) => void addMachine(name, true)}
            />
          ) : (
            <Box
              data-testid="machines-panel"
              sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              <ServerList
                groups={groups}
                fleet={fleet}
                matches={matches}
                actionsFor={actionsFor}
                sourceLabel={sourceLabel}
                onOpen={(row) => openServer(row.key)}
                onChanged={() => void sources.reload()}
                machine={{
                  onOpen: (host) => openMachine(host.id),
                  onMenu: (host, anchor) => setMenu({ host, anchor }),
                  onAddServers: (host) => setAddServersFor(host),
                  onUpdateGame: (host) => void fleet.send(host, 'host.update_game', {}),
                  onUpdateReadyUp: (host) => setReadyUpFor(host),
                  onNewCode: (host) => void newCode(host),
                  onRetry: (host, c) => void fleet.send(host, c.type, c.payload),
                }}
              />
              {licenseMax !== null && hosts.length > 0 && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  data-testid="machines-license-note"
                >
                  {t('machinesPanel.licenseNote', {
                    defaultValue:
                      'Your license covers up to {{count}} servers. Every server counts, spares included.',
                    count: licenseMax,
                  })}
                </Typography>
              )}
            </Box>
          )}
        </>
      )}
      <EmbeddedServerSections value>
        {tab === 'keys' && <FleetPanel showSecret={showSecret} />}
        {tab === 'push' && <FleetPushPanel />}
        {tab === 'autoscale' && <AutoScalePanel />}
        {tab === 'failover' && <FailoverSettingsPanel />}
      </EmbeddedServerSections>

      <Menu anchorEl={addMenu} open={addMenu !== null} onClose={() => setAddMenu(null)}>
        <MenuItem
          data-testid="servers-add-machine"
          onClick={() => {
            setAddMenu(null);
            setAddMachineOpen(true);
          }}
        >
          {t('serversPage.add.machine', { defaultValue: 'Machine' })}
        </MenuItem>
        <MenuItem
          data-testid="servers-add-readyup"
          onClick={() => {
            setAddMenu(null);
            addServer();
          }}
        >
          {t('serversPage.add.readyUp', { defaultValue: 'Ready Up server' })}
        </MenuItem>
      </Menu>

      <Menu anchorEl={menu?.anchor ?? null} open={menu !== null} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            const h = menu?.host;
            setMenu(null);
            if (h) openMachine(h.id);
          }}
        >
          {t('serversBoard.details', { defaultValue: 'Details and activity' })}
        </MenuItem>
        {menu?.host.status === 'pending' && (
          <MenuItem
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              void newCode(h);
            }}
          >
            {t('machinesPanel.newCode', { defaultValue: 'New code' })}
          </MenuItem>
        )}
        {menu?.host.status === 'enrolled' && (
          <MenuItem
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              void rotate(h);
            }}
          >
            {t('machinesPanel.rotate', { defaultValue: 'Rotate token' })}
          </MenuItem>
        )}
        {menu?.host.status === 'enrolled' && (
          <MenuItem
            sx={{ color: 'error.main' }}
            data-testid={`machine-revoke-${menu.host.id}`}
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              setPending({ action: 'revoke', host: h });
            }}
          >
            {t('machinesPanel.revoke', { defaultValue: 'Revoke machine' })}
          </MenuItem>
        )}
        {menu && menu.host.status !== 'enrolled' && (
          <MenuItem
            onClick={() => {
              const h = menu.host;
              setMenu(null);
              setPending({ action: 'remove', host: h });
            }}
          >
            {t('machinesPanel.remove', { defaultValue: 'Remove' })}
          </MenuItem>
        )}
      </Menu>

      <ServerPanel
        rowKey={serverKey}
        row={panelRow}
        fleet={fleet}
        matches={matches}
        onClose={() => openServer(null)}
        onDeleteMachineServer={(host, server) => setDeleteServer({ host, server })}
        onChanged={() => void sources.reload()}
      />
      {dialogs}
      <MachineSheet
        fleet={fleet}
        host={machineHost}
        onClose={() => openMachine(null)}
        onAddServers={(h) => setAddServersFor(h)}
        onUpdateReadyUp={(h) => setReadyUpFor(h)}
        onNewCode={(h) => void newCode(h)}
        onRemove={(h) => setPending({ action: 'remove', host: h })}
      />

      <AddServersDialog fleet={fleet} host={addServersFor} onClose={() => setAddServersFor(null)} />
      <ReadyUpDialog fleet={fleet} host={readyUpFor} onClose={() => setReadyUpFor(null)} />
      <ForceDialog fleet={fleet} />
      <AddMachineDialog
        open={addMachineOpen}
        busy={busy}
        onClose={() => setAddMachineOpen(false)}
        onCreate={(name) => void addMachine(name, false)}
      />
      <LinkDialog
        link={link && !(linkInline && firstSetup) ? link : null}
        connected={linkConnected}
        onClose={() => setLink(null)}
      />

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === 'remove'
            ? t('machinesPanel.confirm.removeTitle', { defaultValue: 'Remove this machine?' })
            : t('machinesPanel.confirm.revokeTitle', { defaultValue: 'Revoke this machine?' })
        }
        message={
          pending?.action === 'remove'
            ? t('machinesPanel.confirm.removeMessage', {
                defaultValue: '{{name}} is forgotten. csm can link it again with a new code.',
                name: pending.host.name,
              })
            : t('machinesPanel.confirm.revokeMessage', {
                defaultValue:
                  '{{name}} is disconnected and its token stops working. Its servers keep running and stay on the fleet link.',
                name: pending?.host.name ?? '',
              })
        }
        confirmColor="error"
        loading={busy}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={deleteServer !== null}
        title={t('machinesPanel.confirm.deleteServerTitle', {
          defaultValue: 'Delete {{name}}?',
          name: deleteServer?.server ?? '',
        })}
        message={t('machinesPanel.confirm.deleteServerMessage', {
          defaultValue:
            '{{name}} is stopped and its folder on {{host}} is deleted. Its Ready Up entry is removed from the fleet. Refused while it plays a match.',
          name: deleteServer?.server ?? '',
          host: deleteServer?.host.name ?? '',
        })}
        confirmColor="error"
        onConfirm={() => {
          const target = deleteServer;
          setDeleteServer(null);
          openServer(null);
          if (target) void fleet.removeServer(target.host, target.server);
        }}
        onCancel={() => setDeleteServer(null)}
      />
    </Box>
  );
}
