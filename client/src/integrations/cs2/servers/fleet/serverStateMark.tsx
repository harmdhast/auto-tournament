import { Box, CircularProgress } from '@mui/material';
import { radii, tokens, useModuleTranslation } from '../../../../module-sdk';
import type { ServerTileState } from '../machineState';
import type { ServerMatch } from './useServerMatches';

const { color } = tokens;

/** A state's colour: free is green, a match the accent, anything in motion blue, the rest muted. */
export const stateTone: Record<ServerTileState, string> = {
  free: color.live,
  match: color.accent,
  starting: color.info,
  stopping: color.info,
  restarting: color.info,
  updating: color.info,
  deleting: color.muted,
  stopped: color.muted,
  offline: color.ban,
};

export const MOVING: ServerTileState[] = [
  'starting',
  'stopping',
  'restarting',
  'updating',
  'deleting',
];

export function useStateLabel() {
  const { t } = useModuleTranslation('cs2');
  return (state: ServerTileState, match?: ServerMatch | null) => {
    if (state === 'match' && match?.phase === 'veto')
      return t('serversBoard.state.veto', { defaultValue: 'Veto' });
    if (state === 'match' && match?.phase === 'warmup')
      return t('serversBoard.state.warmup', { defaultValue: 'Warmup' });
    if (state === 'match' && match?.phase === 'knife')
      return t('serversBoard.state.knife', { defaultValue: 'Knife' });
    if (state === 'match' && match?.phase === 'live')
      return t('serversBoard.state.live', { defaultValue: 'Live' });
    return t(`serversBoard.state.${state}`, {
      defaultValue: {
        free: 'Free',
        match: 'Match',
        starting: 'Starting…',
        stopping: 'Stopping…',
        restarting: 'Restarting…',
        updating: 'Updating…',
        deleting: 'Deleting…',
        stopped: 'Stopped',
        offline: 'Down',
      }[state],
    });
  };
}

/** One line on a match: the teams, the map with its score, how far the series is. */
export function useMatchLine() {
  const { t } = useModuleTranslation('cs2');
  return (m: ServerMatch): string => {
    const parts: string[] = [];
    if (m.team1 || m.team2) parts.push(`${m.team1} vs ${m.team2}`);
    if (m.phase !== 'veto') {
      const score = m.score ? `${m.score[0]} – ${m.score[1]}` : null;
      const showScore = score && m.phase !== 'warmup';
      if (m.map) parts.push(showScore ? `${m.map} ${score}` : m.map);
      else if (showScore) parts.push(score);
    }
    if (m.maps > 1 && m.mapNumber !== null) {
      const of = t('serversBoard.mapOf', {
        defaultValue: 'Map {{n}} of {{count}}',
        n: m.mapNumber + 1,
        count: m.maps,
      });
      parts.push(m.series ? `${of} (${m.series[0]} – ${m.series[1]})` : of);
    }
    return parts.join(' · ');
  };
}

/** The dot or, while something happens to the server, a small spinner. */
export function StateMark({ state, size = 8 }: { state: ServerTileState; size?: number }) {
  if (MOVING.includes(state)) {
    return (
      <CircularProgress
        size={size + 4}
        thickness={6}
        sx={{ color: stateTone[state], flex: 'none' }}
        aria-hidden
      />
    );
  }
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: radii.pill,
        bgcolor: stateTone[state],
        flex: 'none',
      }}
    />
  );
}
