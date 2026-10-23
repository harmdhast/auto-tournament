/**
 * The fleet's HTTP routes, mounted at `/api/fleet` (../routes/index.ts).
 *
 * Public, for Ready Up servers:
 *   POST /api/fleet/enroll                   one-time code or fleet key → server token (FLEET.md §4.1);
 *                                            with `kind: "host"`, a csm host token (./hosts/routes.ts)
 *
 * Admin (`requireAuth`), for the Servers page:
 *   GET    /api/fleet/servers                the registry, with online state and versions
 *   POST   /api/fleet/servers                a pending server + one-time code (shown once)
 *   PATCH  /api/fleet/servers/:id            rename
 *   DELETE /api/fleet/servers/:id            forget a server (it may enroll again)
 *   POST   /api/fleet/servers/:id/code       a fresh code for a pending server
 *   POST   /api/fleet/servers/:id/revoke     revoke its tokens, close its socket (4403)
 *   POST   /api/fleet/servers/:id/rotate     rotate its token now (or on its next connect)
 *   GET    /api/fleet/servers/:id            one server with the players its last snapshot reported
 *   POST   /api/fleet/servers/:id/reset      cmd reset; settles the platform's match there (./reset.ts)
 *   POST   /api/fleet/servers/:id/kick       cmd kick {steamid64, message?}
 *   POST   /api/fleet/servers/:id/link       take matches: link it to a cs2_servers row (./link.ts)
 *   DELETE /api/fleet/servers/:id/link       stop taking matches
 *   GET    /api/fleet/matches/:slug          a match on the fleet: assignment, live state, commands
 *   POST   /api/fleet/matches/:slug/sync     send roster / team name changes (match.update)
 *   GET    /api/fleet/keys                   fleet enrollment keys
 *   POST   /api/fleet/keys                   a new key (shown once)
 *   DELETE /api/fleet/keys/:id               revoke a key
 *
 * The WebSocket (`/api/fleet/ws`) is not a route: the gateway takes it off
 * the HTTP server's `upgrade` event (./gateway.ts).
 */

import type { Untrusted } from '../../../utils/untrusted';
import { Router, type Request, type Response } from 'express';
import { requireAuth, requestActorId } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { FLEET_CLOSE } from './protocol/v1';
import * as registry from './registry';
import { getLatestReadyUpRelease } from '../services/pluginVersionService';
import { readyUpUpdateStatus } from '../services/readyUpVersion';
import { fleetBus, revokeServer, rotateServerToken } from './service';
import {
  checkAddressOverride,
  cs2ServerIdOf,
  renameLinkedRow,
  linkFleetServer,
  setLinkAddress,
  unlinkFleetServer,
} from './link';
import { formatConnectAddress } from './address';
import { auditedFleetCommand, getAssignment, runFleetCommandOn, syncMatch } from './driver';
import { listCommands } from './reliable';
import { liveStateStore } from './state';
import { resetFleetServer } from './reset';
import { fleetPlayersOf } from './players';
import { isSteam64 } from './push/admins';
import { hasControlChars } from './push/settings';
import { execLineError, fleetResponseBody, issuedBy } from '../routes/fleetCommands';
import { isRootRequest } from '../../../utils/rootAccess';
import { fleetChangedOnWrite } from './adminTopics';
import { fleetEnrollRouter, resetEnrollRateLimit } from './enrollRoutes';
import {
  busyReasonResolver,
  handler,
  optionalPositiveInt,
  trimmedString,
  withLinks,
  withLiveState,
} from './routeHelpers';

export { fleetEnrollRouter, resetEnrollRateLimit };

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const fleetAdminRouter = Router();
// Changes here reach the Servers page at once (the `fleet` topic).
fleetAdminRouter.use(fleetChangedOnWrite);
fleetAdminRouter.use(requireAuth);

fleetAdminRouter.get('/servers', async (_req: Request, res: Response) => {
  try {
    const [listed, busyReasonOf] = await Promise.all([
      registry.listFleetServers(),
      busyReasonResolver(),
    ]);
    const live = (await withLinks(withLiveState(listed))).map((s) => ({
      ...s,
      availabilityReason: busyReasonOf(s.id, s.availabilityReason),
    }));
    // Pre-release servers compare against the newest release incl. betas,
    // stable ones against stable releases only (both lookups are cached).
    const servers = await Promise.all(
      live.map(async (s) => {
        const latest = await getLatestReadyUpRelease({ runningVersion: s.versions?.core });
        return {
          ...s,
          // 'unknown' (never a warning) while there is no release to compare against.
          readyUpUpdate: readyUpUpdateStatus(s.versions?.core, latest),
        };
      })
    );
    return res.json({ success: true, count: servers.length, servers });
  } catch (error) {
    log.error(`[FLEET] listing servers failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to list fleet servers' });
  }
});

/** One server, as the list shows it, with the players its last snapshot reported (its panel). */
fleetAdminRouter.get('/servers/:id', async (req: Request, res: Response) => {
  try {
    const found = await registry.getFleetServerView(req.params.id);
    if (!found) return res.status(404).json({ success: false, error: 'Fleet server not found' });
    const busyReasonOf = await busyReasonResolver();
    const [view] = await withLinks(withLiveState([found]));
    return res.json({
      success: true,
      server: {
        ...view,
        availabilityReason: busyReasonOf(view.id, view.availabilityReason),
        players: fleetPlayersOf(view.id),
      },
    });
  } catch (error) {
    log.error(`[FLEET] reading server ${req.params.id} failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to read the fleet server' });
  }
});

fleetAdminRouter.post('/servers', async (req: Request, res: Response) => {
  const name = trimmedString(req.body?.name, 100);
  if (name === null)
    return res.status(400).json({ success: false, error: 'name must be 1-100 characters' });
  try {
    const created = await registry.createPendingServer({
      name: name ?? undefined,
      createdBy: requestActorId(req),
    });
    log.info(
      `[FLEET] pending server ${created.server.id} (${created.server.name}) created with a one-time code`
    );
    return res.status(201).json({
      success: true,
      server: created.server,
      code: created.code,
      expiresAt: created.expiresAt,
    });
  } catch (error) {
    log.error(`[FLEET] creating a pending server failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to create the server' });
  }
});

fleetAdminRouter.patch(
  '/servers/:id',
  handler('rename the server', async (req: Request, res: Response) => {
    const name = trimmedString(req.body?.name, 100);
    if (!name)
      return res.status(400).json({ success: false, error: 'name must be 1-100 characters' });
    const ok = await registry.renameFleetServer(req.params.id, name);
    if (!ok) return res.status(404).json({ success: false, error: 'Fleet server not found' });
    await renameLinkedRow(req.params.id, name);
    return res.json({ success: true, server: await registry.getFleetServerView(req.params.id) });
  })
);

fleetAdminRouter.delete(
  '/servers/:id',
  handler('remove the server', async (req: Request, res: Response) => {
    fleetBus().disconnect(req.params.id, FLEET_CLOSE.REVOKED, 'removed by an admin');
    const ok = await registry.deleteFleetServer(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Fleet server not found' });
    log.info(`[FLEET] ${req.params.id} removed`);
    return res.json({ success: true });
  })
);

fleetAdminRouter.post(
  '/servers/:id/code',
  handler('issue a code', async (req: Request, res: Response) => {
    const issued = await registry.reissueCode(req.params.id, requestActorId(req));
    if (!issued)
      return res
        .status(409)
        .json({ success: false, error: 'Only a pending server gets a new code' });
    return res.status(201).json({ success: true, code: issued.code, expiresAt: issued.expiresAt });
  })
);

fleetAdminRouter.post(
  '/servers/:id/revoke',
  handler('revoke the server', async (req: Request, res: Response) => {
    const ok = await revokeServer(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Fleet server not found' });
    log.info(`[FLEET] ${req.params.id} revoked by ${requestActorId(req) ?? 'unknown'}`);
    return res.json({ success: true, server: await registry.getFleetServerView(req.params.id) });
  })
);

fleetAdminRouter.post('/servers/:id/rotate', async (req: Request, res: Response) => {
  const server = await registry.getFleetServer(req.params.id);
  if (!server) return res.status(404).json({ success: false, error: 'Fleet server not found' });
  if (server.status !== 'enrolled') {
    return res
      .status(409)
      .json({ success: false, error: 'Only an enrolled server has a token to rotate' });
  }
  try {
    if (await rotateServerToken(server.id)) {
      return res.json({ success: true, rotation: 'sent' });
    }
    await registry.requestRotation(server.id);
    return res.status(202).json({ success: true, rotation: 'on_next_connect' });
  } catch (error) {
    log.error(`[FLEET] ${server.id}: rotation failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Rotation failed' });
  }
});

/**
 * Reset: cmd reset ends whatever the server holds; the platform's match there
 * is settled like End match (reset.ts). Any admin.
 */
fleetAdminRouter.post('/servers/:id/reset', async (req: Request, res: Response) => {
  try {
    const outcome = await resetFleetServer(req.params.id, issuedBy(req));
    if (!outcome.ok) {
      return res
        .status(outcome.httpStatus)
        .json({ ok: false, error: outcome.error, errorCode: outcome.errorCode });
    }
    return res.json(outcome);
  } catch (error) {
    log.error(`[FLEET] ${req.params.id}: reset failed: ${(error as Error).message}`);
    return res.status(500).json({ ok: false, error: 'Reset failed', errorCode: null });
  }
});

/** Kick a player (cmd kick, no match needed). Any admin. */
fleetAdminRouter.post('/servers/:id/kick', async (req: Request, res: Response) => {
  const { steamid64, message } = (req.body ?? {}) as { steamid64?: Untrusted; message?: Untrusted };
  if (!isSteam64(steamid64))
    return res.status(400).json({ ok: false, error: 'steamid64 must be a SteamID64' });
  if (
    message !== undefined &&
    (typeof message !== 'string' || message.length > 128 || hasControlChars(message))
  ) {
    return res.status(400).json({ ok: false, error: 'message: one line, at most 128 characters' });
  }
  const server = await registry.getFleetServer(req.params.id);
  if (!server) return res.status(404).json({ ok: false, error: 'Fleet server not found' });
  if (!fleetBus().isConnected(server.id)) {
    return res
      .status(409)
      .json({ ok: false, errorCode: 'offline', error: 'The Ready Up server is offline' });
  }
  try {
    const outcome = await runFleetCommandOn(
      server.id,
      'kick',
      { steamid64, ...(message ? { message } : {}) },
      issuedBy(req)
    );
    if (!outcome.ok) {
      return res
        .status(outcome.httpStatus)
        .json({ ok: false, errorCode: outcome.errorCode, error: outcome.error ?? 'Kick failed' });
    }
    return res.json({ ok: true });
  } catch (error) {
    log.error(`[FLEET] ${server.id}: kick failed: ${(error as Error).message}`);
    return res.status(500).json({ ok: false, error: 'Kick failed' });
  }
});

/** Run a console command on any enrolled server, linked or not. Root only. */
fleetAdminRouter.post('/servers/:id/exec', async (req: Request, res: Response) => {
  if (!isRootRequest(req)) {
    return res.status(403).json({
      success: false,
      error: 'Raw console commands on Ready Up servers are for root admins only',
    });
  }
  const { command } = (req.body ?? {}) as { command?: Untrusted };
  const line = typeof command === 'string' ? command.trim() : '';
  const lineError = execLineError(line);
  if (lineError) return res.status(400).json({ success: false, error: lineError });
  const server = await registry.getFleetServer(req.params.id);
  if (!server) return res.status(404).json({ success: false, error: 'Fleet server not found' });
  if (!fleetBus().isConnected(server.id)) {
    return res.status(409).json({
      success: false,
      errorCode: 'offline',
      error: 'The Ready Up server is offline',
    });
  }
  try {
    const outcome = await auditedFleetCommand(
      server.id,
      'exec',
      { command: line },
      line,
      issuedBy(req)
    );
    return res.status(outcome.httpStatus).json(fleetResponseBody(outcome));
  } catch (error) {
    log.error(`[FLEET] ${server.id}: exec failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Exec failed' });
  }
});

/**
 * Take matches: link the server to a cs2_servers row (`serverId`, an
 * existing server moved to Ready Up) or to a new one named after it. The
 * allocator then hands it matches whenever it is online and `available`.
 */
fleetAdminRouter.post(
  '/servers/:id/link',
  handler('link the server', async (req: Request, res: Response) => {
    const serverId = trimmedString(req.body?.serverId, 100);
    if (serverId === null)
      return res.status(400).json({ success: false, error: 'serverId must be 1-100 characters' });
    const name = trimmedString(req.body?.name, 100);
    if (name === null)
      return res.status(400).json({ success: false, error: 'name must be 1-100 characters' });
    const address = checkAddressOverride({ host: req.body?.host, port: req.body?.port });
    if (!address.ok) return res.status(400).json({ success: false, error: address.error });
    const outcome = await linkFleetServer(req.params.id, {
      ...(serverId ? { serverId } : {}),
      ...(name ? { name } : {}),
      ...(address.override ? { address: address.override } : {}),
    });
    if (!outcome.ok)
      return res.status(outcome.status).json({ success: false, error: outcome.error });
    log.info(
      `[FLEET] ${req.params.id} linked to server ${outcome.link.cs2ServerId}${outcome.created ? ' (new)' : ''} by ${requestActorId(req) ?? 'unknown'}`
    );
    return res
      .status(outcome.created ? 201 : 200)
      .json({ success: true, ...outcome.link, created: outcome.created });
  })
);

/**
 * The connect address of a linked server. Body `{host, port?}` sets an admin
 * override (hellos no longer change it); `{host: null}` (or empty) goes back to
 * the detected address (public_addr, else the link's peer address).
 */
fleetAdminRouter.put(
  '/servers/:id/address',
  handler('set the connect address', async (req: Request, res: Response) => {
    const address = checkAddressOverride({ host: req.body?.host, port: req.body?.port });
    if (!address.ok) return res.status(400).json({ success: false, error: address.error });
    const stored = await setLinkAddress(req.params.id, address.override);
    if (!stored)
      return res.status(404).json({ success: false, error: 'Fleet server is not linked' });
    log.info(
      `[FLEET] ${req.params.id}: connect address ${address.override ? `set to ${stored.host}:${stored.port}` : 'back to automatic'} by ${requestActorId(req) ?? 'unknown'}`
    );
    return res.json({
      success: true,
      cs2ServerId: stored.cs2ServerId,
      host: stored.host,
      port: stored.port,
      address: formatConnectAddress(stored.host, stored.port),
      override: stored.override,
    });
  })
);

fleetAdminRouter.delete(
  '/servers/:id/link',
  handler('unlink the server', async (req: Request, res: Response) => {
    const cs2ServerId = await unlinkFleetServer(req.params.id);
    if (!cs2ServerId)
      return res.status(404).json({ success: false, error: 'Fleet server is not linked' });
    log.info(
      `[FLEET] ${req.params.id} unlinked from server ${cs2ServerId} by ${requestActorId(req) ?? 'unknown'}`
    );
    return res.json({ success: true, cs2ServerId });
  })
);

/**
 * A match on the fleet: its assignment (epoch, server; never the password),
 * the live state record, and the platform's commands with their answers.
 */
fleetAdminRouter.get(
  '/matches/:slug',
  handler('read the fleet match', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    const [assignment, record, commands] = await Promise.all([
      getAssignment(slug),
      liveStateStore.getLiveState(slug),
      listCommands(slug),
    ]);
    if (!assignment && !record)
      return res.status(404).json({ success: false, error: 'Match was never on a fleet server' });
    const linked = assignment?.serverId ? await cs2ServerIdOf(assignment.serverId) : null;
    return res.json({
      success: true,
      assignment: assignment
        ? {
            matchSlug: assignment.matchSlug,
            epoch: assignment.epoch,
            fleetServerId: assignment.serverId,
            serverId: assignment.cs2ServerId ?? linked,
            endedAt: assignment.endedAt,
            config: assignment.config,
          }
        : null,
      liveState: record,
      commands,
    });
  })
);

/** Roster / team name changes since the assignment → `match.update` (config_rev CAS). */
fleetAdminRouter.post(
  '/matches/:slug/sync',
  handler('sync the fleet match', async (req: Request, res: Response) => {
    const outcome = await syncMatch(String(req.params.slug));
    if (!outcome.ok)
      return res.status(outcome.status).json({ success: false, error: outcome.error });
    return res.json({ success: true, ops: outcome.ops, configRev: outcome.configRev });
  })
);

fleetAdminRouter.get(
  '/keys',
  handler('list fleet keys', async (_req: Request, res: Response) => {
    const keys = await registry.listFleetKeys();
    return res.json({ success: true, count: keys.length, keys });
  })
);

fleetAdminRouter.post(
  '/keys',
  handler('create the fleet key', async (req: Request, res: Response) => {
    const name = trimmedString(req.body?.name, 100);
    if (!name)
      return res.status(400).json({ success: false, error: 'name must be 1-100 characters' });
    const namePrefix = trimmedString(req.body?.namePrefix, 40);
    if (namePrefix === null)
      return res.status(400).json({ success: false, error: 'namePrefix must be 1-40 characters' });
    const maxServers = optionalPositiveInt(req.body?.maxServers);
    if (maxServers === null)
      return res
        .status(400)
        .json({ success: false, error: 'maxServers must be a positive integer' });
    const expiresInDays = optionalPositiveInt(req.body?.expiresInDays);
    if (expiresInDays === null)
      return res
        .status(400)
        .json({ success: false, error: 'expiresInDays must be a positive integer' });
    const autoLink = req.body?.autoLink;
    if (autoLink !== undefined && typeof autoLink !== 'boolean') {
      return res.status(400).json({ success: false, error: 'autoLink must be true or false' });
    }
    const skins = req.body?.skins;
    if (skins !== undefined && typeof skins !== 'boolean') {
      return res.status(400).json({ success: false, error: 'skins must be a boolean' });
    }
    const created = await registry.createFleetKey({
      name,
      namePrefix: namePrefix ?? null,
      maxServers: maxServers ?? null,
      expiresAt: expiresInDays ? Math.floor(Date.now() / 1000) + expiresInDays * 86400 : null,
      autoLink: autoLink === true,
      skins: skins === true,
      createdBy: requestActorId(req),
    });
    log.info(`[FLEET] fleet key ${created.key.id} (${created.key.name}) created`);
    return res.status(201).json({ success: true, key: created.key, value: created.value });
  })
);

fleetAdminRouter.delete(
  '/keys/:id',
  handler('revoke the fleet key', async (req: Request, res: Response) => {
    const ok = await registry.revokeFleetKey(req.params.id);
    if (!ok)
      return res
        .status(404)
        .json({ success: false, error: 'Fleet key not found or already revoked' });
    log.info(`[FLEET] fleet key ${req.params.id} revoked`);
    return res.json({ success: true });
  })
);
