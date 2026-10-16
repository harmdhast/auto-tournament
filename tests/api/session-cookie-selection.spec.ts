import { test, expect } from '@playwright/test';
import express from 'express';
import session from 'express-session';
import http from 'http';
import type { AddressInfo } from 'net';
import { createSessionMiddleware } from '../../api/src/utils/sessionCookies';

/**
 * Which cookie the session gets: a Domain cookie for FRONTEND_BASE_URL's host,
 * or a host-only cookie (Secure over https) on any other host, so the browser
 * does not drop it. Behind a proxy the Secure decision follows
 * X-Forwarded-Proto even when Express does not trust the proxy.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const TAGS = { tag: ['@api', '@auth', '@security'] };

async function setCookieFor(
  frontendBaseUrl: string,
  headers: Record<string, string>,
  production = true,
  warn: (msg: string) => void = () => undefined,
  trustProxy = false
): Promise<string | undefined> {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(
    createSessionMiddleware({
      domainStore: new session.MemoryStore(),
      hostOnlyStore: new session.MemoryStore(),
      secret: 'x',
      frontendBaseUrl,
      production,
      warn,
    })
  );
  app.get('/', (req, res) => {
    (req.session as unknown as Record<string, unknown>).seen = true;
    res.end('ok');
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise<string | undefined>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/', headers }, (res) => {
          res.resume();
          resolve(res.headers['set-cookie']?.join('\n'));
        })
        .on('error', reject);
    });
  } finally {
    server.close();
  }
}

test.describe('session cookie selection (pure)', () => {
  test('https base URL: a proxied https request gets a Secure Domain cookie', TAGS, async () => {
    const cookie = await setCookieFor('https://tournament.example.com', {
      Host: 'tournament.example.com',
      'X-Forwarded-Proto': 'https',
    });
    expect(cookie).toMatch(/^at\.sid=/);
    expect(cookie).toMatch(/Domain=tournament\.example\.com/i);
    expect(cookie).toMatch(/Secure/i);
  });

  test('a subdomain of the base host keeps the Domain cookie', TAGS, async () => {
    const cookie = await setCookieFor('https://example.com', {
      Host: 'app.example.com',
      'X-Forwarded-Proto': 'https',
    });
    expect(cookie).toMatch(/Domain=example\.com/i);
  });

  test('a host that is not the base host gets a host-only cookie', TAGS, async () => {
    const cookie = await setCookieFor('https://tournament.example.com', {
      Host: 'mybox.local',
    });
    expect(cookie).toMatch(/^at\.sid=/);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toMatch(/Secure/i);
  });

  test('a lookalike host is not the base host', TAGS, async () => {
    const cookie = await setCookieFor('https://example.com', { Host: 'notexample.com' });
    expect(cookie).not.toMatch(/Domain=/i);
  });

  test('an IP host gets a host-only cookie, Secure only over https', TAGS, async () => {
    const plain = await setCookieFor('https://tournament.example.com', { Host: '10.0.0.5:3069' });
    expect(plain).not.toMatch(/Domain=|Secure/i);
    const tls = await setCookieFor(
      'https://tournament.example.com',
      {
        Host: '10.0.0.5:3069',
        'X-Forwarded-Proto': 'https',
      },
      true,
      undefined,
      true
    );
    expect(tls).toMatch(/Secure/i);
  });

  test('warns once when an https deployment sees plain http on its own host', TAGS, async () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    const headers = { Host: 'tournament.example.com' };
    await setCookieFor('https://tournament.example.com', headers, true, warn);
    expect(warnings.join('\n')).toContain('TRUSTED_PROXIES');
  });

  test('no warning for a proxied https request', TAGS, async () => {
    const warnings: string[] = [];
    await setCookieFor(
      'https://tournament.example.com',
      { Host: 'tournament.example.com', 'X-Forwarded-Proto': 'https' },
      true,
      (m) => warnings.push(m)
    );
    expect(warnings).toEqual([]);
  });
});
