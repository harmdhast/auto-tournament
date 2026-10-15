import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Where the skin catalogue comes from: `SKINS_JSON_URL` when set, GitHub
 * otherwise (an empty value, as an unset compose variable gives, is unset).
 * The compose override hands the variable on to the app container.
 *
 * @tag api
 */

const root = path.resolve(__dirname, '../..');

function urlWith(value: string | undefined): string {
  const env = { ...process.env };
  delete env.SKINS_JSON_URL;
  if (value !== undefined) env.SKINS_JSON_URL = value;
  return execFileSync(
    path.join(root, 'node_modules/.bin/tsx'),
    [
      '-e',
      "import { SKINS_JSON_URL } from './api/src/integrations/cs2/skins/skinService'; console.log('URL=' + SKINS_JSON_URL)",
    ],
    { cwd: root, env, encoding: 'utf8' }
  )
    .split('\n')
    .find((line) => line.startsWith('URL='))!
    .slice(4);
}

test.describe('SKINS_JSON_URL', () => {
  test('an override wins, an empty value falls back', { tag: ['@api'] }, () => {
    expect(urlWith('http://example.test/skins.json')).toBe('http://example.test/skins.json');
    expect(urlWith('')).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
    expect(urlWith(undefined)).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
  });

  test('the compose override passes it to the app', { tag: ['@api'] }, () => {
    const compose = readFileSync(path.join(root, 'docker/docker-compose.fixtures.yml'), 'utf8');
    expect(compose).toContain('SKINS_JSON_URL=${SKINS_JSON_URL:-}');
  });
});
