import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Map image upload -> static serve round trip.
 *
 * Regression test for two bugs, both in `api/src/config/publicPaths.ts`:
 *
 * 1. In the bundled build (and therefore Docker), `POST
 *    /api/maps/:id/upload-image` wrote the file one directory above where
 *    `/map-images/*` serves from, so an uploaded image never came back. Both
 *    paths are now derived from a single constant. See PR #284's "Judgement
 *    calls" section.
 * 2. That directory was under `PUBLIC_DIR` -- build output baked into the
 *    container image, not the mounted volume -- so every container recreate
 *    (every update) deleted every uploaded image. `MAP_IMAGES_DIR` now lives
 *    under `DATA_DIR`, and `docker/Caddyfile` proxies `/map-images/*` to
 *    Express instead of serving it off `/app/public` with its file_server.
 *    See `api/src/config/migrateLegacyMapImages.ts` and
 *    `tests/api/map-images-migration.spec.ts`.
 *
 * @tag api
 * @tag maps
 */

// A 1x1 transparent PNG, inlined so this test needs no fixture file.
const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let counter = 0;
function uniqueMapId(): string {
  counter += 1;
  return `test_map_image_${Date.now()}_${counter}`;
}

async function createMap(request: APIRequestContext, id: string) {
  const res = await request.post('/api/maps', {
    data: { id, displayName: `Test Map ${id}` },
  });
  expect(res.ok(), `POST /api/maps: ${await res.text()}`).toBe(true);
}

async function deleteMap(request: APIRequestContext, id: string) {
  await request.delete(`/api/maps/${id}`);
}

test.describe('Map image upload', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test(
    'an uploaded image is reachable through /map-images',
    { tag: ['@api', '@maps'] },
    async ({ request }) => {
      const id = uniqueMapId();
      await createMap(request, id);

      try {
        const uploadRes = await request.post(`/api/maps/${id}/upload-image`, {
          data: { imageData: `data:image/png;base64,${ONE_PX_PNG_BASE64}` },
        });
        expect(uploadRes.ok(), `upload-image: ${await uploadRes.text()}`).toBe(true);
        const uploadBody = await uploadRes.json();
        expect(uploadBody.success).toBe(true);
        expect(uploadBody.imageUrl).toMatch(new RegExp(`^/map-images/${id}\\.png\\?v=\\d+$`));

        // The route only returns a relative URL; fetch it back exactly the
        // way a browser would, through the static /map-images mount.
        const imageRes = await request.get(uploadBody.imageUrl);
        expect(imageRes.ok(), `GET ${uploadBody.imageUrl}: ${imageRes.status()}`).toBe(true);
        expect(imageRes.headers()['content-type']).toContain('image/png');

        const bytes = await imageRes.body();
        expect(Buffer.compare(bytes, Buffer.from(ONE_PX_PNG_BASE64, 'base64'))).toBe(0);

        // The map record itself should also carry the URL.
        const mapRes = await request.get(`/api/maps/${id}`);
        expect(mapRes.ok(), `GET /api/maps/${id}: ${await mapRes.text()}`).toBe(true);
        const mapBody = await mapRes.json();
        expect(mapBody.map.imageUrl).toBe(uploadBody.imageUrl);
      } finally {
        await deleteMap(request, id);
      }
    }
  );

  test(
    'a small copy is stored and served with long-lived cache headers',
    { tag: ['@api', '@maps'] },
    async ({ request }) => {
      const id = uniqueMapId();
      await createMap(request, id);
      const dataUrl = `data:image/webp;base64,${ONE_PX_PNG_BASE64}`;

      try {
        const uploadRes = await request.post(`/api/maps/${id}/upload-image`, {
          data: { imageData: dataUrl, smallImageData: dataUrl },
        });
        expect(uploadRes.ok(), `upload-image: ${await uploadRes.text()}`).toBe(true);
        const { imageUrl } = await uploadRes.json();
        expect(imageUrl).toMatch(new RegExp(`^/map-images/${id}\\.webp\\?v=\\d+$`));

        const smallRes = await request.get(`/map-images/${id}-small.webp`);
        expect(smallRes.status()).toBe(200);
        expect(smallRes.headers()['cache-control']).toContain('immutable');

        const fullRes = await request.get(imageUrl);
        expect(fullRes.status()).toBe(200);
        expect(fullRes.headers()['cache-control']).toContain('immutable');
      } finally {
        await deleteMap(request, id);
      }

      expect((await request.get(`/map-images/${id}.webp`)).status()).toBe(404);
      expect((await request.get(`/map-images/${id}-small.webp`)).status()).toBe(404);
    }
  );

  test(
    'an upload without a small copy still works and drops an older small copy',
    { tag: ['@api', '@maps'] },
    async ({ request }) => {
      const id = uniqueMapId();
      await createMap(request, id);
      const dataUrl = `data:image/webp;base64,${ONE_PX_PNG_BASE64}`;

      try {
        await request.post(`/api/maps/${id}/upload-image`, {
          data: { imageData: dataUrl, smallImageData: dataUrl },
        });
        const res = await request.post(`/api/maps/${id}/upload-image`, {
          data: { imageData: `data:image/png;base64,${ONE_PX_PNG_BASE64}` },
        });
        expect(res.ok(), `upload-image: ${await res.text()}`).toBe(true);
        expect((await res.json()).imageUrl).toMatch(
          new RegExp(`^/map-images/${id}\\.png\\?v=\\d+$`)
        );
        expect((await request.get(`/map-images/${id}.webp`)).status()).toBe(404);
        expect((await request.get(`/map-images/${id}-small.webp`)).status()).toBe(404);
      } finally {
        await deleteMap(request, id);
      }
    }
  );

  test(
    'a small copy that is not webp is rejected',
    { tag: ['@api', '@maps'] },
    async ({ request }) => {
      const id = uniqueMapId();
      await createMap(request, id);

      try {
        const res = await request.post(`/api/maps/${id}/upload-image`, {
          data: {
            imageData: `data:image/png;base64,${ONE_PX_PNG_BASE64}`,
            smallImageData: `data:image/png;base64,${ONE_PX_PNG_BASE64}`,
          },
        });
        expect(res.status()).toBe(400);
      } finally {
        await deleteMap(request, id);
      }
    }
  );

  test(
    'a missing map image is a miss, not the SPA shell',
    { tag: ['@api', '@maps'] },
    async ({ request }) => {
      // `/map-images/*` is served off `MAP_IMAGES_DIR`, which now lives under
      // DATA_DIR rather than inside the `/app/public` tree `docker/Caddyfile`
      // roots its file_server at. If that route ever stops reaching Express
      // (or the directory drifts again), Caddy's SPA fallback answers instead
      // and every map image comes back as a 200 full of index.html -- which a
      // broken <img> makes very hard to spot. Assert the miss stays a miss.
      const res = await request.get(`/map-images/${uniqueMapId()}.png`);

      expect(res.status(), 'a missing map image should not be served as the SPA shell').not.toBe(
        200
      );
      expect(res.headers()['content-type'] ?? '').not.toContain('text/html');
    }
  );
});
