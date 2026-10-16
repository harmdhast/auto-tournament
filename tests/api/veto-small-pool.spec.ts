import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { createAndStartTournament } from '../helpers/tournaments';
import { findMatchByTeams } from '../helpers/matches';
import {
  executeVetoActions,
  getVetoState,
  actingSteamIdFor,
  type VetoAction,
} from '../helpers/veto';
import type { Team } from '../helpers/teams';

/**
 * Veto order for map pools smaller than 7
 *
 * @tag api
 * @tag veto
 */

const ALL_MAPS = [
  'de_mirage',
  'de_inferno',
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_vertigo',
  'de_nuke',
];

test.describe.serial('Veto with a small map pool', () => {
  let team1: Team;
  let team2: Team;

  const as = (team: Team) => ({ teamSlug: team.id, actAsSteamId: actingSteamIdFor(team) });

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    await signInViaRequest(request);
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: ALL_MAPS,
      teamCount: 2,
      serverCount: 1,
      prefix: 'veto-small',
    });
    expect(setup).toBeTruthy();
    [team1, team2] = [setup!.teams[0], setup!.teams[1]];
  });

  async function startVeto(format: 'bo1' | 'bo3' | 'bo5', maps: string[]) {
    const tournament = await createAndStartTournament(request_, {
      name: `Small Pool ${format} ${maps.length} ${Date.now()}`,
      type: 'single_elimination',
      format,
      maps,
      teamIds: [team1.id, team2.id],
    });
    expect(tournament).toBeTruthy();
    const match = await findMatchByTeams(request_, team1.id, team2.id);
    expect(match).toBeTruthy();
    return match!.slug as string;
  }

  let request_: import('@playwright/test').APIRequestContext;
  test.beforeEach(({ request }) => {
    request_ = request;
  });

  async function stateOf(slug: string) {
    return getVetoState(request_, slug, actingSteamIdFor(team1));
  }

  test('bo1 with 1 map is a single side pick', { tag: ['@api', '@veto', '@bo1'] }, async () => {
    const slug = await startVeto('bo1', ['de_mirage']);
    const before = await stateOf(slug);
    expect(before.totalSteps).toBe(1);
    expect(before.currentAction).toBe('side_pick');
    expect(before.vetoOrder).toEqual([{ step: 1, team: 'team2', action: 'side_pick' }]);

    expect(await executeVetoActions(request_, slug, [{ side: 'CT', ...as(team2) }])).toBeTruthy();
    const state = await stateOf(slug);
    expect(state.status).toBe('completed');
    expect(state.pickedMaps).toHaveLength(1);
    expect(state.pickedMaps[0].mapName).toBe('de_mirage');
    expect(state.pickedMaps[0].sideTeam2).toBe('CT');
  });

  test(
    'bo1 with 4 maps alternates 3 bans then a team2 side pick',
    { tag: ['@api', '@veto', '@bo1'] },
    async () => {
      const slug = await startVeto('bo1', ALL_MAPS.slice(0, 4));
      expect((await stateOf(slug)).totalSteps).toBe(4);

      const actions: VetoAction[] = [
        { mapName: 'de_mirage', ...as(team1) },
        { mapName: 'de_inferno', ...as(team2) },
        { mapName: 'de_ancient', ...as(team1) },
        { side: 'T', ...as(team2) },
      ];
      expect(await executeVetoActions(request_, slug, actions)).toBeTruthy();

      const state = await stateOf(slug);
      expect(state.status).toBe('completed');
      expect(state.pickedMaps).toHaveLength(1);
      expect(state.pickedMaps[0].mapName).toBe('de_anubis');
      expect(state.pickedMaps[0].sideTeam2).toBe('T');
    }
  );

  test('bo1 with 7 maps keeps 7 steps', { tag: ['@api', '@veto', '@bo1'] }, async () => {
    const slug = await startVeto('bo1', ALL_MAPS);
    expect((await stateOf(slug)).totalSteps).toBe(7);
  });

  test(
    'bo3 with 3 maps picks twice and the decider is the last map',
    { tag: ['@api', '@veto', '@bo3'] },
    async () => {
      const slug = await startVeto('bo3', ALL_MAPS.slice(0, 3));
      const before = await stateOf(slug);
      expect(before.totalSteps).toBe(5);
      expect(before.vetoOrder.map((s: any) => s.action)).toEqual([
        'pick',
        'side_pick',
        'pick',
        'side_pick',
        'side_pick',
      ]);

      const actions: VetoAction[] = [
        { mapName: 'de_mirage', ...as(team1) },
        { side: 'CT', ...as(team2) },
        { mapName: 'de_inferno', ...as(team2) },
        { side: 'T', ...as(team1) },
        { side: 'CT', ...as(team2) },
      ];
      expect(await executeVetoActions(request_, slug, actions)).toBeTruthy();

      const state = await stateOf(slug);
      expect(state.status).toBe('completed');
      expect(state.pickedMaps.map((m: any) => m.mapName)).toEqual([
        'de_mirage',
        'de_inferno',
        'de_ancient',
      ]);
    }
  );

  test('bo3 with 5 maps has 2 bans', { tag: ['@api', '@veto', '@bo3'] }, async () => {
    const slug = await startVeto('bo3', ALL_MAPS.slice(0, 5));
    expect((await stateOf(slug)).totalSteps).toBe(7);

    const actions: VetoAction[] = [
      { mapName: 'de_mirage', ...as(team1) },
      { mapName: 'de_inferno', ...as(team2) },
      { mapName: 'de_ancient', ...as(team1) },
      { side: 'CT', ...as(team2) },
      { mapName: 'de_anubis', ...as(team2) },
      { side: 'T', ...as(team1) },
      { side: 'CT', ...as(team2) },
    ];
    expect(await executeVetoActions(request_, slug, actions)).toBeTruthy();

    const state = await stateOf(slug);
    expect(state.status).toBe('completed');
    expect(state.pickedMaps).toHaveLength(3);
  });

  test(
    'bo5 with 5 maps picks 4 and adds the decider',
    { tag: ['@api', '@veto', '@bo5'] },
    async () => {
      const slug = await startVeto('bo5', ALL_MAPS.slice(0, 5));
      expect((await stateOf(slug)).totalSteps).toBe(8);

      const actions: VetoAction[] = [
        { mapName: 'de_mirage', ...as(team1) },
        { side: 'CT', ...as(team2) },
        { mapName: 'de_inferno', ...as(team2) },
        { side: 'CT', ...as(team1) },
        { mapName: 'de_ancient', ...as(team1) },
        { side: 'CT', ...as(team2) },
        { mapName: 'de_anubis', ...as(team2) },
        { side: 'CT', ...as(team1) },
      ];
      expect(await executeVetoActions(request_, slug, actions)).toBeTruthy();

      const state = await stateOf(slug);
      expect(state.status).toBe('completed');
      expect(state.pickedMaps).toHaveLength(5);
      expect(state.pickedMaps[4].mapName).toBe('de_dust2');
    }
  );

  test(
    'a custom bo1 order with 6 bans is rejected for a 4-map pool',
    { tag: ['@api', '@veto', '@custom'] },
    async ({ request }) => {
      const bans = [1, 2, 3, 4, 5, 6].map((step) => ({
        step,
        team: step % 2 ? 'team1' : 'team2',
        action: 'ban',
      }));
      const response = await request.post('/api/tournament', {
        data: {
          name: `Small Pool Custom ${Date.now()}`,
          type: 'single_elimination',
          format: 'bo1',
          maps: ALL_MAPS.slice(0, 4),
          teamIds: [team1.id, team2.id],
          settings: {
            customVetoOrder: { bo1: [...bans, { step: 7, team: 'team2', action: 'side_pick' }] },
          },
        },
      });
      expect(response.ok()).toBeFalsy();
    }
  );
});
