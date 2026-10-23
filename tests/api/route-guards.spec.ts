import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { routeTable } from '../../api/src/routes/routeTable';

/**
 * Which middleware stands in front of every route, read off the routers
 * (no server, no database) and compared with a committed snapshot, so a new
 * route or a changed guard is a reviewed diff in tests/fixtures/route-guards.json.
 *
 * Regenerate after a deliberate change:
 *   UPDATE_ROUTE_GUARDS=1 npx playwright test -c tests/playwright.config.ts tests/api/route-guards.spec.ts
 *
 * @tag api
 * @tag security
 */

const TAGS = { tag: ['@api', '@security'] };
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'route-guards.json');

/** Body parsers are not guards. */
const PARSERS = new Set(['jsonParser', 'rawParser', 'urlencodedParser', 'textParser']);

/** Middleware that decides who may call a route. */
const GUARDS = new Set([
  'requireAuth',
  'requirePlayer',
  'requireRecorder',
  'requireIntegratorAuth',
  'validateServerToken',
  'validateEventToken',
  'serverOrHostToken',
  'validateServerOrFleetToken',
  'requireMatchConfigAccess',
  'requireCompatIngestToken',
  'requireTestEndpoints',
  'requireTestHelpers',
  'requireLoopback',
]);

/** Test-only gates (ENABLE_TEST_ENDPOINTS). */
const TEST_GATES = new Set(['requireTestEndpoints', 'requireTestHelpers', 'requireRconEnabled']);

/**
 * Writes without a guard middleware: the handler identifies the caller
 * itself. Each entry says how; a new unguarded write must be added here.
 */
const INLINE_AUTH: Array<[RegExp, string]> = [
  [/^\S+ \/api\/skins\/me\//, 'signed-in player resolved in the handler (playerOrStop)'],
  [/^POST \/api\/veto\/:matchSlug\/action$/, "the viewer's team in the match, in the handler"],
  [/^PUT \/api\/game\/cs2\/players\/me\/role$/, 'signed-in player resolved in the handler'],
  [/^POST \/api\/fleet\/enroll$/, 'enrollment code or fleet key in the body; rate-limited'],
  [/^POST \/api\/game\/manual\/matches\/:slug\//, 'a team captain of the match, in the handler'],
  [/^POST \/api\/chat\/:channel\//, "the viewer's access to the channel, in the handler"],
  [/^\S+ \/api\/tournament-signup\/:id\//, 'the signed-in captain, in the handler'],
  [/^\S+ \/api\/team-directory\//, 'team member, owner or invitee, in the handler'],
  [/^PUT \/api\/players\/me\/(discord-id|shown-team)$/, 'signed-in player resolved in the handler'],
  [/^POST \/api\/player-reports$/, 'signed-in player, same-site (guardWrite)'],
  [/^\S+ \/api\/me\//, 'signed-in viewer resolved in the handler'],
  [/^POST \/api\/email\/(verify|unsubscribe)$/, 'signed token in the body'],
  [/^POST \/api\/setup\//, 'one-time setup code in the body, while no admin exists'],
  [/^\S+ \/api\/auth\//, 'sign-in, sign-out and account-link flows (credentials in the request)'],
  [
    /^PUT \/api\/match-lineups\/:slug\/:side$/,
    "an admin, or the team's owner or a captain, in the handler",
  ],
  [
    /^PUT \/api\/commends\/match\/:slug\/:playerId$/,
    'a signed-in player of the match, same-site, in the handler',
  ],
];

interface Layer {
  name?: string;
  handle?: unknown;
  regexp?: { fast_slash?: boolean };
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: Array<{ name?: string }>;
  };
}

function nameOf(fn: { name?: string }): string {
  return fn.name || '<anonymous>';
}

/** "METHOD /path" → middleware names in order, first registration wins. */
function walk(
  router: unknown,
  prefix: string,
  inherited: string[],
  out: Map<string, string[]>
): void {
  const stack = (router as { stack?: Layer[] }).stack;
  if (!Array.isArray(stack)) throw new Error(`no router stack under ${prefix}`);
  const use = [...inherited];
  for (const layer of stack) {
    if (!layer.route) {
      if (layer.name === 'router') {
        if (!layer.regexp?.fast_slash) throw new Error(`nested router with a path under ${prefix}`);
        walk(layer.handle, prefix, use, out);
        continue;
      }
      const n = nameOf(layer);
      if (!PARSERS.has(n) && !use.includes(n)) use.push(n);
      continue;
    }
    const names = [...use];
    for (const h of layer.route.stack.slice(0, -1)) {
      const n = nameOf(h);
      if (!PARSERS.has(n) && !names.includes(n)) names.push(n);
    }
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const p of paths) {
      for (const m of Object.keys(layer.route.methods)) {
        const key = `${m.toUpperCase()} ${p === '/' ? prefix || '/' : `${prefix}${p}`}`;
        if (!out.has(key)) out.set(key, names);
      }
    }
  }
}

function collect(mounts: typeof routeTable): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of mounts) walk(m.router, m.prefix, [], out);
  return out;
}

/** Test-only mounts are registered only in test runs, so they stay out of the snapshot. */
const routes = collect(routeTable.filter((m) => !m.testOnly));
const all = collect(routeTable);
const isWrite = (key: string) => !/^(GET|HEAD|OPTIONS) /.test(key);

test.describe('route guards', () => {
  test('match the committed snapshot', TAGS, () => {
    const current = Object.fromEntries(
      [...routes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, v.join(' + ') || 'public'])
    );
    if (process.env.UPDATE_ROUTE_GUARDS) {
      fs.writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
    }
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
    expect(current, 'route guards changed: review, then UPDATE_ROUTE_GUARDS=1').toEqual(committed);
  });

  test('every write has a guard, or says how its handler checks the caller', TAGS, () => {
    const unguarded = [...all.entries()]
      .filter(([key, names]) => isWrite(key) && !names.some((n) => GUARDS.has(n)))
      .map(([key]) => key)
      .filter((key) => !INLINE_AUTH.some(([re]) => re.test(key)));
    expect(unguarded).toEqual([]);
  });

  test('every /api/test route is behind the test endpoints switch', TAGS, () => {
    const ungated = [...all.entries()]
      .filter(([key]) => / \/api\/test(\/|$)/.test(key))
      .filter(([, names]) => !names.some((n) => TEST_GATES.has(n)))
      .map(([key]) => key);
    expect(ungated).toEqual([]);
  });

  test('every allowlisted write still exists', TAGS, () => {
    const writes = [...all.keys()].filter(isWrite);
    const stale = INLINE_AUTH.filter(([re]) => !writes.some((k) => re.test(k))).map(([re]) =>
      String(re)
    );
    expect(stale).toEqual([]);
  });
});
