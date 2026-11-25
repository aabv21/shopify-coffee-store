import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { CANCELLATION_SQL, freshAppDb, ORDER_STATUS_SQL, workflowQuery } from '../lib/pglite.ts';

const RECORD_ORDER = workflowQuery('intake-order.json', 'Record order');

let db: PGlite | undefined;
const fresh = async (): Promise<PGlite> => (db = await freshAppDb());
afterEach(async () => {
  await db?.close();
  db = undefined;
});

async function record(pg: PGlite, orderId: string, customerId: string, receivedAt?: string): Promise<void> {
  await pg.query(RECORD_ORDER, [orderId, `#T${orderId}`, customerId]);
  // Postgres stamps received_at on insert; a test that needs a known order sets it afterwards.
  if (receivedAt !== undefined) await pg.query('UPDATE orders SET received_at = $2 WHERE order_id = $1', [orderId, receivedAt]);
}

const status = async (pg: PGlite, orderId: string): Promise<{ cancelled: boolean; reordered: boolean; recorded: boolean }> =>
  (await pg.query<{ cancelled: boolean; reordered: boolean; recorded: boolean }>(ORDER_STATUS_SQL, [orderId])).rows[0] ?? { cancelled: false, reordered: false, recorded: false };

describe('cancelling an order', () => {
  it('a cancellation of a recorded order records it once and returns its id', async () => {
    const pg = await fresh();
    await record(pg, '7000000001', '8000000001');
    expect((await pg.query(CANCELLATION_SQL, ['7000000001'])).rows).toEqual([{ order_id: '7000000001' }]);
  });

  it('a second cancellation of the same order records nothing', async () => {
    const pg = await fresh();
    await record(pg, '7000000001', '8000000001');
    await pg.query(CANCELLATION_SQL, ['7000000001']);
    expect((await pg.query(CANCELLATION_SQL, ['7000000001'])).rows).toEqual([]);
    expect((await pg.query('SELECT count(*)::int AS n FROM order_cancellations')).rows).toEqual([{ n: 1 }]);
  });

  it('a cancellation for an order the store never recorded records nothing', async () => {
    const pg = await fresh();
    expect((await pg.query(CANCELLATION_SQL, ['9999999999999'])).rows).toEqual([]);
    expect((await pg.query('SELECT count(*)::int AS n FROM order_cancellations')).rows).toEqual([{ n: 0 }]);
  });

  it('the status query reports a recorded cancellation', async () => {
    const pg = await fresh();
    await record(pg, '7000000001', '8000000001');
    expect(await status(pg, '7000000001')).toEqual({ cancelled: false, reordered: false, recorded: true });
    await pg.query(CANCELLATION_SQL, ['7000000001']);
    expect(await status(pg, '7000000001')).toEqual({ cancelled: true, reordered: false, recorded: true });
  });

  it('deleting an order removes its cancellation', async () => {
    const pg = await fresh();
    await record(pg, '7000000001', '8000000001');
    await pg.query(CANCELLATION_SQL, ['7000000001']);
    await pg.query('DELETE FROM orders WHERE order_id = $1', ['7000000001']);
    expect((await pg.query('SELECT count(*)::int AS n FROM order_cancellations')).rows).toEqual([{ n: 0 }]);
  });
});

describe('the recorded check', () => {
  it('an erased order reads not recorded, and so is not cancelled or reordered either', async () => {
    const pg = await fresh();
    await record(pg, '7000000001', '8000000002', '2026-11-01T10:00:00Z');
    await record(pg, '7000000002', '8000000002', '2026-11-10T10:00:00Z');
    await pg.query(CANCELLATION_SQL, ['7000000001']);
    await pg.query("DELETE FROM orders WHERE customer_id = '8000000002'");
    expect(await status(pg, '7000000001')).toEqual({ cancelled: false, reordered: false, recorded: false });
  });

  it('an order the store never recorded reads not recorded', async () => {
    const pg = await fresh();
    expect((await status(pg, '9999999999999')).recorded).toBe(false);
  });
});

describe('the reorder check', () => {
  it('reordered is true only for a later, uncancelled order by the same customer', async () => {
    const pg = await fresh();
    await record(pg, '7000000001', '8000000002', '2026-11-01T10:00:00Z');
    await record(pg, '7000000002', '8000000002', '2026-11-10T10:00:00Z');
    await record(pg, '7000000003', '8000000003', '2026-11-12T10:00:00Z');
    expect((await status(pg, '7000000001')).reordered).toBe(true);
    // The later order is its own customer's first, not a reorder of the earlier one.
    expect((await status(pg, '7000000002')).reordered).toBe(false);
    await pg.query(CANCELLATION_SQL, ['7000000002']);
    expect((await status(pg, '7000000001')).reordered).toBe(false);
  });

  it('an order by another customer does not count as a reorder', async () => {
    const pg = await fresh();
    await record(pg, '7000000001', '8000000002', '2026-11-01T10:00:00Z');
    await record(pg, '7000000003', '8000000003', '2026-11-12T10:00:00Z');
    expect((await status(pg, '7000000001')).reordered).toBe(false);
  });

  it('an earlier order does not count as a reorder of a later one', async () => {
    const pg = await fresh();
    await record(pg, '7000000001', '8000000002', '2026-11-10T10:00:00Z');
    await record(pg, '7000000002', '8000000002', '2026-11-01T10:00:00Z');
    expect((await status(pg, '7000000001')).reordered).toBe(false);
  });

  it('a guest order never counts as a reorder', async () => {
    const pg = await fresh();
    await record(pg, '7000000001', '', '2026-11-01T10:00:00Z');
    await record(pg, '7000000002', '', '2026-11-10T10:00:00Z');
    expect((await pg.query('SELECT customer_id FROM orders ORDER BY order_id')).rows).toEqual([{ customer_id: null }, { customer_id: null }]);
    expect((await status(pg, '7000000001')).reordered).toBe(false);
  });
});
