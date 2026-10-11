/**
 * One panel for every server, its sections by what the server has: Ready Up
 * (state, reset, players, console), its machine (csm start, stop, delete),
 * or its RCON settings.
 */
import { useState, type ReactNode } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useModuleTranslation } from '../../../../module-sdk';
import type { FleetHost, Server } from '../../cs2.types';
import ServerModal from '../ServerModal';
import { Facts, SideSheet } from '../fleet/SideSheet';
import type { Fleet } from '../fleet/useFleet';
import type { ServerMatch } from '../fleet/useServerMatches';
import { CopyConnect } from './CopyConnect';
import { MachineServerSection } from './MachineServerSection';
import { ReadyUpServerSection } from './ReadyUpServerSection';
import { useRconState } from './ServerList';
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
  servers,
  readAt,
  onClose,
  onDeleteMachineServer,
  onChanged,
}: {
  /** `?server=` as given: a Ready Up key whose server left the list still opens (it says it is gone). */
  rowKey: string | null;
  row: ServerRow | null;
  fleet: Fleet;
  matches: Record<string, ServerMatch>;
  /** Every platform server record, for the RCON settings dialog. */
  servers: Server[];
  readAt: number;
  onClose: () => void;
  onDeleteMachineServer: (host: FleetHost, server: string) => void;
  onChanged: () => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const rconState = useRconState();
  const [editing, setEditing] = useState<Server | null>(null);
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
            <ReadyUpServerSection fleetId={fleetId} onChanged={onChanged} />
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
  } else if (row?.kind === 'readyup' || lostFleetId) {
    const fleetId = row?.kind === 'readyup' ? row.fleet.id : lostFleetId!;
    title = row?.kind === 'readyup' ? row.fleet.name : '';
    body = <ReadyUpServerSection fleetId={fleetId} onChanged={onChanged} />;
  } else if (row?.kind === 'rcon') {
    const s = row.server;
    title = s.name;
    body = (
      <Section title={t('serversList.transport.rcon', { defaultValue: 'RCON' })}>
        <Box data-testid="server-panel-rcon" sx={{ display: 'grid', gap: 2 }}>
          <Facts
            items={[
              [t('serversBoard.facts.state', { defaultValue: 'State' }), rconState(s, readAt).word],
              [
                t('serversList.facts.address', { defaultValue: 'Address' }),
                <Box key="addr" component="span" data-testid="server-host">
                  <CopyConnect address={`${s.host}:${s.port}`} />
                </Box>,
              ],
              !!s.currentMatch && [
                t('serversBoard.facts.match', { defaultValue: 'Match' }),
                s.currentMatch,
              ],
              !!s.pluginVersion && [
                t('serversList.facts.plugin', { defaultValue: 'Plugin' }),
                s.pluginVersion,
              ],
            ]}
          />
          <Box>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setEditing(s)}
              data-testid="server-panel-edit"
            >
              {t('serversList.edit', { defaultValue: 'Edit' })}
            </Button>
          </Box>
        </Box>
      </Section>
    );
  }

  return (
    <>
      <SideSheet
        open={open}
        onClose={onClose}
        testId="server-panel"
        title={title}
        subtitle={subtitle}
      >
        {body}
      </SideSheet>
      <ServerModal
        open={editing !== null}
        server={editing}
        servers={servers}
        onClose={() => setEditing(null)}
        onSave={onChanged}
      />
    </>
  );
}
