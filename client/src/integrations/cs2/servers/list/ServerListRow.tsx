import type { MouseEvent, ReactNode } from 'react';
import { Box, ButtonBase, Tooltip } from '@mui/material';
import { WarningIcon } from '@phosphor-icons/react';
import { openMatchDetails, radii, tokens, useModuleTranslation } from '../../../../module-sdk';
import type { FleetServer } from '../../cs2.types';
import { serverState } from '../machineState';
import { runningOf } from '../fleet/MachineCard';
import {
  MOVING,
  StateChip,
  StateMark,
  stateTone,
  useMatchLine,
  useStateLabel,
} from '../fleet/serverStateMark';
import type { ServerMatch } from '../fleet/useServerMatches';
import {
  AvailabilityChip,
  AvailabilityReason,
  availabilityOf,
  availabilityTone,
  hasAvailabilityReason,
} from '../fleet/readyup/AvailabilityChip';
import { ResetServerButton } from '../fleet/readyup/ResetServerButton';
import { isGuessedAddress, type ServerRow } from './serverGroups';
import { CopyConnect } from './CopyConnect';
import type { ServerAction } from './useFleetServerActions';
import { formatWhenShort } from '../time';
import { DOT, Line, RowMenu, rowGrid, type ServerListProps } from './ServerListParts';

const { color } = tokens;

export function ServerListRow({
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
  const matchLine = useMatchLine();
  const locale = i18n.language;
  const fleetServer: FleetServer | null = row.fleet;

  let name: string;
  let mark: ReactNode;
  let state: ReactNode;
  let reason: ReactNode = null;
  let address: string | null = null;
  let version: string | null = null;
  let match: ServerMatch | null = null;
  let line = '';

  if (row.kind === 'machine') {
    const { host, server } = row;
    const machineState = serverState(host, server, props.fleet.isDeleting(host, server.name));
    const matchKey = row.fleet?.linkedServerId ?? server.fleetServer?.id;
    match = matchKey ? (props.matches[matchKey] ?? null) : null;
    line = match ? matchLine(match) : '';
    name = row.fleet?.name ?? server.fleetServer?.name ?? server.name;
    // The machine's word while csm moves it, stopped or down; Ready Up's once it runs.
    const readyUpSays =
      row.fleet &&
      !MOVING.includes(machineState) &&
      machineState !== 'stopped' &&
      machineState !== 'offline';
    const inMatch =
      match !== null &&
      !MOVING.includes(machineState) &&
      machineState !== 'stopped' &&
      machineState !== 'offline';
    if (inMatch) {
      mark = <StateMark state="match" />;
      state = <StateChip label={stateLabel('match', match)} tone={stateTone.match} />;
    } else if (readyUpSays && row.fleet) {
      mark = <Box aria-hidden sx={{ ...DOT, bgcolor: availabilityTone(row.fleet) }} />;
      state = <AvailabilityChip server={row.fleet} />;
    } else {
      mark = <StateMark state={machineState} />;
      state = <StateChip label={stateLabel(machineState, match)} tone={stateTone[machineState]} />;
    }
    if (inMatch && line) {
      reason = <Line area="sub">{line}</Line>;
    } else if (MOVING.includes(machineState)) {
      // Its own command, else the machine update it is part of.
      const own =
        host.commands.find(
          (c) =>
            c.status === 'pending' && (c.server === server.name || c.payload.server === server.name)
        ) ??
        runningOf(host, 'host.update_game') ??
        runningOf(host, 'host.update_plugins');
      reason = (
        <Line area="sub">
          {own?.progress.step ??
            (own?.seq === null
              ? t('serversBoard.waitingForCsm', { defaultValue: 'Waiting for csm' })
              : t('serversBoard.csmOnIt', { defaultValue: 'csm is on it' }))}
        </Line>
      );
    } else if (machineState === 'stopped') {
      reason = (
        <Line area="sub">
          {t('serversBoard.stoppedLine', { defaultValue: 'Starts when a match needs it' })}
        </Line>
      );
    } else if (machineState === 'offline') {
      reason = (
        <Line area="sub">
          {host.online
            ? t('serversBoard.notAnswering', { defaultValue: 'Not answering' })
            : t('serversBoard.machineOffline', { defaultValue: 'Its machine is offline' })}
        </Line>
      );
    } else if (readyUpSays && row.fleet && hasAvailabilityReason(row.fleet)) {
      reason = <AvailabilityReason server={row.fleet} />;
    } else if (server.process.restarts_24h > 0) {
      reason = (
        <Line area="sub">
          {t('serversBoard.restarts', {
            defaultValue: '{{count}} restarts in 24 h',
            count: server.process.restarts_24h,
          })}
        </Line>
      );
    }
    address =
      row.fleet?.connect?.address ??
      (host.hostname ? `${host.hostname}:${server.game_port}` : null);
    version = row.fleet?.versions?.core ?? server.readyup.installed;
  } else {
    const f = row.fleet;
    match = props.matches[f.linkedServerId ?? f.id] ?? null;
    line = match ? matchLine(match) : '';
    const inMatch = match !== null && f.status === 'enrolled' && f.online;
    name = f.name;
    mark = (
      <Box aria-hidden sx={{ ...DOT, bgcolor: inMatch ? stateTone.match : availabilityTone(f) }} />
    );
    if (inMatch) {
      state = <StateChip label={stateLabel('match', match)} tone={stateTone.match} />;
    } else if (f.status === 'enrolled') {
      state = <AvailabilityChip server={f} />;
    } else {
      state = <StateChip label={t(`fleetPanel.status.${f.status}`)} tone={color.muted} />;
    }
    if (inMatch && line) {
      reason = <Line area="sub">{line}</Line>;
    } else if (f.status === 'enrolled' && !f.online && f.lastSeen) {
      reason = (
        <Line area="sub">
          {t('serversList.seen', {
            defaultValue: 'Seen {{time}}',
            time: formatWhenShort(f.lastSeen, locale),
          })}
        </Line>
      );
    } else if (f.status === 'pending' && f.codeExpiresAt) {
      reason = (
        <Line area="sub">
          {t('fleetPanel.codeExpires', { time: formatWhenShort(f.codeExpiresAt, locale) })}
        </Line>
      );
    } else if (hasAvailabilityReason(f)) {
      reason = <AvailabilityReason server={f} />;
    }
    address = f.connect?.address ?? (f.host ? `${f.host.hostname}:${f.host.game_port}` : null);
    version = f.versions?.core ?? null;
  }

  const guessed = fleetServer ? isGuessedAddress(fleetServer) : false;
  const busy = fleetServer?.status === 'enrolled' && availabilityOf(fleetServer) === 'busy';
  const pushFailed = fleetServer ? pushProblems.has(fleetServer.id) : false;
  const items: ServerAction[] = [
    {
      id: 'open',
      label: t('serversList.open', { defaultValue: 'Open' }),
      run: () => props.onOpen(row),
    },
    ...(match
      ? [
          {
            id: 'match' as const,
            label: t('serversBoard.openMatch', { defaultValue: 'Open the match' }),
            testId: `server-row-open-match-${row.key}`,
            run: () => void openMatchDetails(match.slug).catch(() => undefined),
          },
        ]
      : []),
    ...(fleetServer ? props.actionsFor(fleetServer) : []),
  ];
  const addressLine = address && (
    <>
      <CopyConnect address={address} />
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
      <Box
        data-testid={`server-row-dot-${row.key}`}
        sx={{ gridArea: 'dot', display: 'flex', justifyContent: 'center' }}
      >
        {mark}
      </Box>
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

