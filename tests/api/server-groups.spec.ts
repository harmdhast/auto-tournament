import { test, expect } from '@playwright/test';
import {
  buildServerGroups,
  rowForFleetServer,
} from '../../client/src/integrations/cs2/servers/list/serverGroups';
import type { FleetHost, FleetServer, Server } from '../../client/src/integrations/cs2/cs2.types';
import { fleetServer } from '../helpers/fleetUi';

/**
 * The Servers page lists every server once, grouped by machine: a machine
 * server linked to Ready Up stays on its machine; Ready Up servers on no
 * machine, then RCON servers, go under No machine.
 *
 * @tag fleet
 */

const fleet = (id: string, over: Record<string, unknown> = {}) =>
  fleetServer(id, over) as unknown as FleetServer;

const host = (
  id: string,
  over: Partial<FleetHost> = {},
  servers: Array<{ name: string; fleetId?: string }> = []
) =>
  ({
    id,
    name: id,
    status: 'enrolled',
    online: true,
    ...over,
    servers: servers.map((s) => ({
      name: s.name,
      fleetServer: s.fleetId
        ? {
            id: s.fleetId,
            name: s.fleetId,
            status: 'enrolled',
            online: true,
            availability: null,
            readyUpVersion: null,
          }
        : null,
    })),
  }) as unknown as FleetHost;

const rcon = (id: string, transport: 'rcon' | 'fleet' = 'rcon') =>
  ({ id, name: id, transport }) as unknown as Server;

test.describe('server groups', () => {
  test('a machine server linked to Ready Up is one row on its machine', () => {
    const groups = buildServerGroups(
      [host('h1', {}, [{ name: 'cs2-1', fleetId: 'f1' }])],
      [fleet('f1'), fleet('f2')],
      []
    );
    expect(groups.map((g) => g.key)).toEqual(['h1', 'none']);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0]).toMatchObject({ kind: 'machine', key: 'm:h1:cs2-1' });
    expect((groups[0].rows[0] as { fleet: FleetServer }).fleet.id).toBe('f1');
    expect(groups[1].rows.map((r) => r.key)).toEqual(['r:f2']);
  });

  test('linked fleet server offline stays on its machine', () => {
    const groups = buildServerGroups(
      [host('h1', {}, [{ name: 'cs2-1', fleetId: 'f1' }])],
      [fleet('f1', { online: false, status: 'revoked' })],
      []
    );
    expect(groups.map((g) => g.key)).toEqual(['h1']);
    expect((groups[0].rows[0] as { fleet: FleetServer }).fleet.id).toBe('f1');
  });

  test('RCON servers come after Ready Up in No machine; fleet-transport records are skipped', () => {
    const groups = buildServerGroups([], [fleet('f2')], [rcon('s1'), rcon('s2', 'fleet')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.key)).toEqual(['r:f2', 'x:s1']);
  });

  test('No machine is omitted when empty', () => {
    const groups = buildServerGroups([host('h1', {}, [{ name: 'cs2-1' }])], [], []);
    expect(groups.map((g) => g.key)).toEqual(['h1']);
    expect(groups[0].rows[0]).toMatchObject({ kind: 'machine', fleet: null });
  });

  test('machines keep their order: online, pending, offline, revoked', () => {
    const groups = buildServerGroups(
      [
        host('revoked', { status: 'revoked', online: false }),
        host('offline', { online: false }),
        host('pending', { status: 'pending', online: false }),
        host('online'),
      ],
      [],
      []
    );
    expect(groups.map((g) => g.key)).toEqual(['online', 'pending', 'offline', 'revoked']);
  });

  test('revoked Ready Up servers come last under No machine', () => {
    const groups = buildServerGroups(
      [],
      [fleet('a', { name: 'a', status: 'revoked' }), fleet('b', { name: 'b' })],
      []
    );
    expect(groups[0].rows.map((r) => r.key)).toEqual(['r:b', 'r:a']);
  });

  test('rowForFleetServer finds machine and Ready Up rows', () => {
    const groups = buildServerGroups(
      [host('h1', {}, [{ name: 'cs2-1', fleetId: 'f1' }])],
      [fleet('f1'), fleet('f2')],
      []
    );
    expect(rowForFleetServer(groups, 'f1')?.key).toBe('m:h1:cs2-1');
    expect(rowForFleetServer(groups, 'f2')?.key).toBe('r:f2');
    expect(rowForFleetServer(groups, 'zz')).toBeNull();
  });
});
