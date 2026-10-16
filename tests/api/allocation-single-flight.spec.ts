import { test, expect } from '@playwright/test';
import { db } from '../../api/src/config/database';
import { scheduler } from '../../api/src/core/scheduler';
import { getIntegration } from '../../api/src/integrations/registry';

/**
 * Concurrent allocateSingleMatch callers for one match (availability trigger,
 * waiting sweep, polling tick) must share one allocation, not reserve one
 * server each.
 *
 * @tag api
 * @tag allocation
 */
const SLUG = `single-flight-${Date.now()}`;

test.afterAll(async () => {
  await db.runAsync('DELETE FROM matches WHERE slug = ?', [SLUG]);
});

test('two concurrent allocations of one match allocate once', { tag: ['@api'] }, async () => {
  await db.insertAsync('matches', {
    slug: SLUG,
    tournament_id: null,
    round: 0,
    match_number: 0,
    config: '{}',
    status: 'ready',
  });

  const integration = getIntegration('cs2');
  const original = { capacity: integration.capacity, allocate: integration.allocate };
  const allocated: string[] = [];
  integration.capacity = async () => 2;
  integration.allocate = async () => {
    const server = `fake-server-${allocated.length + 1}`;
    allocated.push(server);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { status: 'assigned', resourceId: server };
  };

  try {
    const [a, b] = await Promise.all([
      scheduler.allocateSingleMatch(SLUG, ''),
      scheduler.allocateSingleMatch(SLUG, ''),
    ]);
    expect(allocated).toHaveLength(1);
    expect(a.success).toBe(true);
    expect(b).toEqual(a);

    // The slot is free again once the allocation settled.
    const again = await scheduler.allocateSingleMatch(SLUG, '');
    expect(again.success).toBe(true);
    expect(allocated).toHaveLength(2);
  } finally {
    integration.capacity = original.capacity;
    integration.allocate = original.allocate;
  }
});
