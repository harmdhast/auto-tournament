/**
 * Every server on one list, grouped by the machine that runs it: one line
 * per server (two on a phone) with its state, why it takes no match, where
 * players connect and its version. A row opens the server's panel; its menu
 * holds the rest.
 */
import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  Box,
  ButtonBase,
  Chip,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { DotsThreeIcon, WarningIcon } from '@phosphor-icons/react';
import { mono, radii, tokens, useModuleTranslation } from '../../../../module-sdk';
import type { FleetHost, FleetHostCommand, FleetServer, Server } from '../../cs2.types';
import { serverState } from '../machineState';
import { MachineCard } from '../fleet/MachineCard';
import { MOVING, StateMark, useStateLabel } from '../fleet/serverStateMark';
import type { Fleet } from '../fleet/useFleet';
import type { ServerMatch } from '../fleet/useServerMatches';
import {
  AvailabilityChip,
  AvailabilityReason,
  availabilityOf,
} from '../fleet/readyup/AvailabilityChip';
import { ResetServerButton } from '../fleet/readyup/ResetServerButton';
import { isGuessedAddress, type ServerGroup, type ServerRow } from './serverGroups';
import { useFleetPushProblems } from './useFleetPushProblems';
import type { ServerAction } from './useFleetServerActions';

const { color } = tokens;

/** An RCON server's dot colour and state word (the list carries no live status). */
export function useRconState() {
  const { t } = useModuleTranslation('cs2');
  return (s: Server, readAt: number): { tone: string; word: string } => {
    // Up when it reported in the last two minutes.
    const up = s.status === 'online' || (!!s.lastSeen && readAt - s.lastSeen < 120);
    if (!s.enabled)
      return {
        tone: color.muted,
        word: t('serversBoard.other.disabled', { defaultValue: 'Disabled' }),
      };
    if (!up)
      return { tone: color.ban, word: t('serversBoard.state.offline', { defaultValue: 'Down' }) };
    return {
      tone: color.live,
      word: s.currentMatch
        ? t('serversBoard.state.match', { defaultValue: 'Match' })
        : t('serversBoard.state.free', { defaultValue: 'Free' }),
    };
  };
}

export interface MachineHandlers {
  onOpen: (host: FleetHost) => void;
  onMenu: (host: FleetHost, anchor: HTMLElement) => void;
  onAddServers: (host: FleetHost) => void;
  onUpdateGame: (host: FleetHost) => void;
  onUpdateReadyUp: (host: FleetHost) => void;
  onNewCode: (host: FleetHost) => void;
  onRetry: (host: FleetHost, command: FleetHostCommand) => void;
}

export interface ServerListProps {
  groups: ServerGroup[];
  fleet: Fleet;
  matches: Record<string, ServerMatch>;
  readAt: number;
  actionsFor: (server: FleetServer) => ServerAction[];
  sourceLabel: (connect: FleetServer['connect']) => string;
  onOpen: (row: ServerRow) => void;
  onChanged: () => void;
  machine: MachineHandlers;
}

const DOT = { width: 8, height: 8, borderRadius: radii.pill, flex: 'none' } as const;

/** The columns: one line from `md`, two below (name and state, then the reason or the address). */
const rowGrid = {
  display: 'grid',
  alignItems: 'center',
  columnGap: 1.5,
  rowGap: 0.25,
  px: 1.5,
  py: { xs: 1, md: 0.75 },
  minHeight: 44,
  cursor: 'pointer',
  gridTemplateColumns: {
    xs: '12px minmax(0, 1fr) auto auto',
    md: '12px minmax(0, 1.3fr) 104px minmax(0, 1.6fr) minmax(0, 1fr) 64px 96px',
  },
  gridTemplateAreas: {
    xs: '"dot name state actions" ". sub sub sub"',
    md: '"dot name state sub addr ver actions"',
  },
  borderTop: `1px solid ${color.rule}`,
  '&:first-of-type': { borderTop: 'none' },
  '&:hover': { bgcolor: color.paper3 },
} as const;

function when(s: number | null | undefined, locale: string): string {
  if (!s) return '—';
  const d = new Date(s * 1000);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

function Line({
  children,
  area,
  testId,
  phoneOnly,
  wide,
  monoText,
}: {
  children: ReactNode;
  area: string;
  testId?: string;
  phoneOnly?: boolean;
  wide?: boolean;
  monoText?: boolean;
}) {
  return (
    <Typography
      component="span"
      variant="caption"
      color="text.secondary"
      noWrap
      data-testid={testId}
      sx={{
        gridArea: area,
        minWidth: 0,
        display: phoneOnly
          ? { xs: 'block', md: 'none' }
          : wide
            ? { xs: 'none', md: 'block' }
            : 'block',
        ...(monoText ? mono : {}),
      }}
    >
      {children}
    </Typography>
  );
}

function RowMenu({ name, items, testId }: { name: string; items: ServerAction[]; testId: string }) {
  const { t } = useModuleTranslation('cs2');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (items.length === 0) return null;
  return (
    <>
      <IconButton
        size="small"
        aria-label={t('serversList.menu', { defaultValue: 'More for {{name}}', name })}
        onClick={(e) => setAnchor(e.currentTarget)}
        data-testid={testId}
      >
        <DotsThreeIcon size={18} weight="bold" />
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {items.map((item) => (
          <MenuItem
            key={item.id}
            data-testid={item.testId}
            sx={item.danger ? { color: 'error.main' } : undefined}
            onClick={() => {
              setAnchor(null);
              item.run();
            }}
          >
            {item.icon && <ListItemIcon sx={{ color: 'inherit' }}>{item.icon}</ListItemIcon>}
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function ServerListRow({
  row,
  props,
  pushProblems,
}: {
  row: ServerRow;
  props: ServerListProps;
  pushProblems: Set<string>;
}) {
  const { t, i18n } = useModuleTranslation('cs2');
  const stateLabel = useStateLabel();
  const rconState = useRconState();
  const locale = i18n.language;
  const fleetServer: FleetServer | null = row.kind === 'rcon' ? null : row.fleet;

  let name: string;
  let mark: ReactNode;
  let state: ReactNode;
  let reason: ReactNode = null;
  let address: string | null = null;
  let version: string | null = null;
  let tag: string | null = null;

  if (row.kind === 'rcon') {
    const s = row.server;
    const { tone, word } = rconState(s, props.readAt);
    name = s.name;
    mark = <Box aria-hidden sx={{ ...DOT, bgcolor: tone }} />;
    state = <Chip size="small" variant="outlined" label={word} />;
    address = `${s.host}:${s.port}`;
    version = s.pluginVersion ?? null;
    tag = t('serversList.transport.rcon', { defaultValue: 'RCON' });
  } else if (row.kind === 'machine') {
    const { host, server } = row;
    const machineState = serverState(host, server, props.fleet.isDeleting(host, server.name));
    const match = server.fleetServer ? (props.matches[server.fleetServer.id] ?? null) : null;
    name = row.fleet?.name ?? server.fleetServer?.name ?? server.name;
    mark = <StateMark state={machineState} />;
    // The machine's word while csm moves it, stopped or down; Ready Up's once it runs.
    const readyUpSays =
      row.fleet &&
      !MOVING.includes(machineState) &&
      machineState !== 'stopped' &&
      machineState !== 'offline';
    state =
      readyUpSays && row.fleet ? (
        <AvailabilityChip server={row.fleet} />
      ) : (
        <Chip size="small" variant="outlined" label={stateLabel(machineState, match)} />
      );
    if (machineState === 'match' && match && (match.team1 || match.team2)) {
      reason = (
        <Line area="sub">
          {[
            `${match.team1} vs ${match.team2}`,
            match.score && match.phase !== 'veto' ? `${match.score[0]} – ${match.score[1]}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Line>
      );
    } else if (MOVING.includes(machineState)) {
      const own = host.commands.find(
        (c) =>
          c.status === 'pending' && (c.server === server.name || c.payload.server === server.name)
      );
      reason = (
        <Line area="sub">
          {own?.progress.step ??
            (own?.seq === null
              ? t('serversBoard.waitingForCsm', { defaultValue: 'Waiting for csm' })
              : t('serversBoard.csmOnIt', { defaultValue: 'csm is on it' }))}
        </Line>
      );
    } else if (readyUpSays && row.fleet) {
      reason = <AvailabilityReason server={row.fleet} />;
    }
    address = row.fleet?.connect?.address ?? `${host.hostname ?? host.name}:${server.game_port}`;
    version = row.fleet?.versions?.core ?? server.readyup.installed;
    tag = row.fleet ? t('serversList.transport.readyUp', { defaultValue: 'Ready Up' }) : null;
  } else {
    const f = row.fleet;
    name = f.name;
    const tone =
      f.status === 'revoked'
        ? color.ban
        : f.status === 'pending'
          ? color.info
          : f.online
            ? color.live
            : color.muted;
    mark = <Box aria-hidden sx={{ ...DOT, bgcolor: tone }} />;
    state =
      f.status === 'enrolled' ? (
        <AvailabilityChip server={f} />
      ) : (
        <Chip size="small" variant="outlined" label={t(`fleetPanel.status.${f.status}`)} />
      );
    if (f.status === 'enrolled' && !f.online && f.lastSeen) {
      reason = (
        <Line area="sub">
          {t('serversList.seen', { defaultValue: 'Seen {{time}}', time: when(f.lastSeen, locale) })}
        </Line>
      );
    } else if (f.status === 'pending' && f.codeExpiresAt) {
      reason = (
        <Line area="sub">
          {t('fleetPanel.codeExpires', { time: when(f.codeExpiresAt, locale) })}
        </Line>
      );
    } else {
      reason = <AvailabilityReason server={f} />;
    }
    address = f.connect?.address ?? (f.host ? `${f.host.hostname}:${f.host.game_port}` : null);
    version = f.versions?.core ?? null;
    tag = t('serversList.transport.readyUp', { defaultValue: 'Ready Up' });
  }

  const guessed = fleetServer ? isGuessedAddress(fleetServer) : false;
  const busy = fleetServer?.status === 'enrolled' && availabilityOf(fleetServer) === 'busy';
  const pushFailed = fleetServer ? pushProblems.has(fleetServer.id) : false;
  const items: ServerAction[] = [
    {
      id: 'open',
      label:
        row.kind === 'rcon'
          ? t('serversList.edit', { defaultValue: 'Edit' })
          : t('serversList.open', { defaultValue: 'Open' }),
      run: () => props.onOpen(row),
    },
    ...(fleetServer ? props.actionsFor(fleetServer) : []),
  ];
  const addressLine = address && (
    <>
      {address}
      {guessed && (
        <Tooltip
          title={t('fleetPanel.connectGuessed', {
            defaultValue:
              'Guessed from where the server connects from. Check it, or set the address players use.',
          })}
        >
          <Box
            component="span"
            data-testid={`server-row-guessed-${row.key}`}
            sx={{ display: 'inline-flex', verticalAlign: 'middle', ml: 0.5, color: 'warning.main' }}
          >
            <WarningIcon
              size={13}
              aria-label={fleetServer ? props.sourceLabel(fleetServer.connect) : ''}
            />
          </Box>
        </Tooltip>
      )}
    </>
  );

  return (
    <Box
      role="listitem"
      data-testid={`server-row-${row.key}`}
      onClick={() => props.onOpen(row)}
      sx={rowGrid}
    >
      <Box sx={{ gridArea: 'dot', display: 'flex', justifyContent: 'center' }}>{mark}</Box>
      <Box sx={{ gridArea: 'name', minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
        <ButtonBase
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            props.onOpen(row);
          }}
          title={name}
          sx={{
            minWidth: 0,
            justifyContent: 'flex-start',
            borderRadius: radii.sm,
            fontWeight: 600,
            fontSize: '0.875rem',
            '&.Mui-focusVisible': { outline: `2px solid ${color.focus}` },
          }}
        >
          <Box
            component="span"
            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {name}
          </Box>
        </ButtonBase>
        {tag && (
          <Box
            component="span"
            sx={{
              display: { xs: 'none', md: 'inline' },
              fontSize: '0.6875rem',
              color: color.muted,
              border: `1px solid ${color.rule}`,
              borderRadius: radii.pill,
              px: 0.75,
              whiteSpace: 'nowrap',
            }}
          >
            {tag}
          </Box>
        )}
      </Box>
      <Box
        data-testid={`server-row-state-${row.key}`}
        sx={{ gridArea: 'state', display: 'flex', minWidth: 0 }}
      >
        {state}
      </Box>
      {reason ? (
        <Box
          sx={{
            gridArea: 'sub',
            minWidth: 0,
            '& > *': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          }}
        >
          {reason}
        </Box>
      ) : (
        addressLine && (
          <Line area="sub" phoneOnly monoText>
            {addressLine}
          </Line>
        )
      )}
      <Line area="addr" wide monoText testId={`server-row-address-${row.key}`}>
        {addressLine ?? '—'}
      </Line>
      <Line area="ver" wide monoText testId={`server-row-version-${row.key}`}>
        {version ?? '—'}
      </Line>
      <Box
        sx={{
          gridArea: 'actions',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 0.25,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {pushFailed && (
          <Tooltip
            title={t('serversList.pushProblem', {
              defaultValue: 'A push to this server failed or got no answer',
            })}
          >
            <Box
              component="span"
              data-testid={`server-row-push-${row.key}`}
              sx={{ display: 'inline-flex', color: 'warning.main', px: 0.5 }}
            >
              <WarningIcon size={18} />
            </Box>
          </Tooltip>
        )}
        {busy && fleetServer && (
          <Box component="span" data-testid={`server-row-reset-${row.key}`}>
            <ResetServerButton server={fleetServer} onDone={props.onChanged} />
          </Box>
        )}
        <RowMenu name={name} items={items} testId={`server-row-menu-${row.key}`} />
      </Box>
    </Box>
  );
}

export function ServerList(props: ServerListProps) {
  const { t } = useModuleTranslation('cs2');
  const fleetIds = props.groups.flatMap((g) =>
    g.rows.flatMap((r) => (r.kind !== 'rcon' && r.fleet ? [r.fleet.id] : []))
  );
  const pushProblems = useFleetPushProblems(fleetIds);
  const guessedAny = props.groups.some((g) =>
    g.rows.some((r) => r.kind !== 'rcon' && r.fleet && isGuessedAddress(r.fleet))
  );
  const rows = (group: ServerGroup) => (
    <Box role="list">
      {group.rows.map((row) => (
        <ServerListRow key={row.key} row={row} props={props} pushProblems={pushProblems} />
      ))}
    </Box>
  );

  return (
    <Box data-testid="servers-list" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {guessedAny && (
        <Box
          role="status"
          data-testid="servers-guessed-banner"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: 'warning.main',
            fontSize: '0.8125rem',
          }}
        >
          <WarningIcon size={16} style={{ flex: 'none' }} />
          {t('serversList.guessedBanner', {
            defaultValue:
              'Some addresses were guessed from where the server connects. Check them, or set the address players use.',
          })}
        </Box>
      )}
      {props.groups.map((group) =>
        group.host ? (
          <Box key={group.key} data-testid={`server-group-${group.key}`}>
            <MachineCard
              host={group.host}
              onOpenMachine={() => props.machine.onOpen(group.host!)}
              onMenu={(anchor) => props.machine.onMenu(group.host!, anchor)}
              onAddServers={() => props.machine.onAddServers(group.host!)}
              onUpdateGame={() => props.machine.onUpdateGame(group.host!)}
              onUpdateReadyUp={() => props.machine.onUpdateReadyUp(group.host!)}
              onNewCode={() => props.machine.onNewCode(group.host!)}
              onRetry={(c) => props.machine.onRetry(group.host!, c)}
            >
              {group.rows.length > 0 && rows(group)}
            </MachineCard>
          </Box>
        ) : (
          <Box
            key={group.key}
            component="section"
            data-testid={`server-group-${group.key}`}
            aria-labelledby="server-group-none-title"
            sx={{
              borderRadius: radii.lg,
              bgcolor: color.paper2,
              border: `1px solid ${color.rule}`,
              p: { xs: 1.5, md: 2 },
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <Box>
              <Typography
                id="server-group-none-title"
                component="h2"
                sx={{ fontWeight: 600, fontSize: '1rem' }}
              >
                {t('serversList.noMachine', { defaultValue: 'No machine' })}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('serversList.noMachineAbout', {
                  defaultValue:
                    'Ready Up servers that enrolled on their own, and servers added by address.',
                })}
              </Typography>
            </Box>
            {rows(group)}
          </Box>
        )
      )}
    </Box>
  );
}
