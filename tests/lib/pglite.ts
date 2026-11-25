import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { orderMigrations } from '../../scripts/db-migrate.ts';

const KEPT = /^(CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE)\b/i;
// Role, grant and ownership statements need the real cluster; the test database has no roles.
const SKIPPED = /^(GRANT|REVOKE|SELECT|CREATE ROLE|ALTER ROLE|ALTER DEFAULT PRIVILEGES)\b|^ALTER TABLE\b[\s\S]*\bOWNER TO\b/i;

/**
 * The schema-shaping statements of a SQL file, for a database with no roles: drops `--` comments,
 * turns each psql meta-command into a statement break, and keeps CREATE TABLE, CREATE [UNIQUE]
 * INDEX and ALTER TABLE. Roles, grants and ownership are skipped; any other statement throws, so
 * a migration can't change the schema in a way the tests silently miss.
 */
export function schemaStatements(sql: string): string[] {
  const kept: string[] = [];
  const lines = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).map((line) => (line.trimStart().startsWith('\\') ? ';' : line));
  for (const raw of lines.join('\n').split(/;[ \t]*(?:\n|$)/)) {
    const statement = raw.trim().replace(/;$/, '');
    if (statement === '' || SKIPPED.test(statement)) continue;
    if (!KEPT.test(statement)) throw new Error(`tests/lib/pglite.ts does not know how to apply: ${statement.split('\n')[0] ?? ''}`);
    kept.push(statement);
  }
  return kept;
}

/** An in-process Postgres holding db/schema.sql and every migration's tables, as the app database has them. */
export async function freshAppDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync('db/schema.sql', 'utf8'));
  for (const file of orderMigrations(readdirSync('db/migrations'))) {
    for (const statement of schemaStatements(readFileSync(join('db/migrations', file), 'utf8'))) await db.exec(statement);
  }
  return db;
}

/** The SQL of one Postgres node, read from the committed workflow JSON. */
export function workflowQuery(file: string, node: string): string {
  const workflow = JSON.parse(readFileSync(join('workflows', file), 'utf8')) as { nodes: { name: string; parameters: { query?: string } }[] };
  const query = workflow.nodes.find((n) => n.name === node)?.parameters.query;
  if (query === undefined) throw new Error(`${file}: no "${node}" node with a query`);
  return query;
}

/** `cancel-order` › `Record cancellation`: records a cancellation once, and only for an order the store recorded. */
export const CANCELLATION_SQL = `INSERT INTO order_cancellations (order_id)
SELECT $1::text
WHERE EXISTS (SELECT 1 FROM orders WHERE order_id = $1::text)
ON CONFLICT (order_id) DO NOTHING RETURNING order_id;
`;

/** `process-order` and `reorder-reminder` › `Check order status`: cancelled, reordered by the same customer, and still recorded (an erased order is not). */
export const ORDER_STATUS_SQL = `SELECT
  EXISTS (SELECT 1 FROM order_cancellations WHERE order_id = $1) AS cancelled,
  EXISTS (
    SELECT 1 FROM orders this_order
    JOIN orders later ON later.customer_id = this_order.customer_id AND later.received_at > this_order.received_at
    WHERE this_order.order_id = $1
      AND NOT EXISTS (SELECT 1 FROM order_cancellations c WHERE c.order_id = later.order_id)
  ) AS reordered,
  EXISTS (SELECT 1 FROM orders WHERE order_id = $1) AS recorded;
`;
