/**
 * One panel for every server, its sections by what the server has: Ready Up
 * (state, reset, players, console) and its machine (csm start, stop, delete).
 */
import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { useModuleTranslation } from '../../../../module-sdk';
import type { FleetHost } from '../../cs2.types';
import { SideSheet } from '../fleet/SideSheet';
import type { Fleet } from '../fleet/useFleet';
import type { ServerMatch } from '../fleet/useServerMatches';
import { MachineServerSection } from './MachineServerSection';
import { ReadyUpServerSection } from './ReadyUpServerSection';
import type { ServerRow } from './serverGroups';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ display: 'grid', gap: 1.5 }}>
      <Typography variant="subtitle2" fontWeight={600}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

export function ServerPanel({
  rowKey,
  row,
  fleet,
  matches,
  onClose,
  onDeleteMachineServer,
  onChanged,
}: {
  /** `?server=` as given: a Ready Up key whose server left the list still opens (it says it is gone). */
  rowKey: string | null;
  row: ServerRow | null;
  fleet: Fleet;
  matches: Record<string, ServerMatch>;
  onClose: () => void;
  onDeleteMachineServer: (host: FleetHost, server: string) => void;
  onChanged: () => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const lostFleetId = !row && rowKey?.startsWith('r:') ? rowKey.slice(2) : null;
  const open = !!row || !!lostFleetId;

  let title = '';
  let subtitle: string | undefined;
  let body: ReactNode = null;
  const readyUpTitle = t('serversList.transport.readyUp', { defaultValue: 'Ready Up' });

  if (row?.kind === 'machine') {
    const fleetId = row.fleet?.id ?? row.server.fleetServer?.id ?? null;
    title = row.fleet?.name ?? row.server.fleetServer?.name ?? row.server.name;
    subtitle = `${row.host.name} · ${row.server.name}`;
    body = (
      <>
        {fleetId && (
          <Section title={readyUpTitle}>
            <ReadyUpServerSection
              fleetId={fleetId}
              matchSlug={matches[fleetId]?.slug}
              onChanged={onChanged}
            />
          </Section>
        )}
        <Section title={t('serversList.section.machine', { defaultValue: 'Machine' })}>
          <MachineServerSection
            fleet={fleet}
            host={row.host}
            serverName={row.server.name}
            match={fleetId ? (matches[fleetId] ?? null) : null}
            onDelete={onDeleteMachineServer}
          />
        </Section>
      </>
    );
  } else if (row?.kind === 'readyup') {
    title = row.fleet.name;
    body = (
      <ReadyUpServerSection
        fleetId={row.fleet.id}
        matchSlug={
          (matches[row.fleet.linkedServerId ?? row.fleet.id] ?? matches[row.fleet.id])?.slug
        }
        onChanged={onChanged}
      />
    );
  } else if (lostFleetId) {
    body = <ReadyUpServerSection fleetId={lostFleetId} onChanged={onChanged} />;
  }

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      testId="server-panel"
      title={title}
      subtitle={subtitle}
    >
      {body}
    </SideSheet>
  );
}
