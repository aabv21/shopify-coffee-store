import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshAppDb, schemaStatements, workflowQuery } from '../lib/pglite.ts';

const RECORD_ORDER = workflowQuery('intake-order.json', 'Record order');
const ORDER = ['7000000001', '#T1001', '8000000001'];

let db: PGlite | undefined;
const fresh = async (): Promise<PGlite> => (db = await freshAppDb());
afterEach(async () => {
  await db?.close();
  db = undefined;
});

const count = async (pg: PGlite): Promise<number> => Number((await pg.query<{ n: string }>('SELECT count(*) AS n FROM orders')).rows[0]?.n);

describe('the order gate (Record order)', () => {
  it('records a new order and returns its id', async () => {
    const pg = await fresh();
    const result = await pg.query(RECORD_ORDER, ORDER);
    expect(result.rows).toEqual([{ order_id: '7000000001' }]);
  });

  it('the same order a second time records nothing and returns no id', async () => {
    const pg = await fresh();
    await pg.query(RECORD_ORDER, ORDER);
    const again = await pg.query(RECORD_ORDER, ORDER);
    expect(again.rows).toEqual([]);
    expect(await count(pg)).toBe(1);
  });
});

describe('schemaStatements', () => {
  it('keeps DDL and drops psql meta-commands, grants, and ownership changes', () => {
    const sql = [
      '-- a comment; with a semicolon',
      '\\getenv runtime_role APP_RUNTIME_DB_USER',
      'CREATE TABLE a (id int PRIMARY KEY);',
      'GRANT SELECT, INSERT ON a TO someone;',
      'ALTER TABLE a OWNER TO someone;',
      'ALTER TABLE a ADD COLUMN note text;',
      'CREATE INDEX a_note ON a (note);',
      'REVOKE ALL ON a FROM PUBLIC;',
    ].join('\n');
    expect(schemaStatements(sql)).toEqual(['CREATE TABLE a (id int PRIMARY KEY)', 'ALTER TABLE a ADD COLUMN note text', 'CREATE INDEX a_note ON a (note)']);
  });

  it('keeps a unique index', () => {
    expect(schemaStatements('CREATE UNIQUE INDEX a_key ON a (id);')).toEqual(['CREATE UNIQUE INDEX a_key ON a (id)']);
  });

  it('keeps the statement after a psql meta-command that ends a query', () => {
    const sql = "SELECT format('CREATE ROLE %I', 'x')\n\\gexec\nCREATE TABLE b (id int);";
    expect(schemaStatements(sql)).toEqual(['CREATE TABLE b (id int)']);
  });

  it.each(['CREATE TYPE mood AS ENUM (\'a\');', 'CREATE SEQUENCE s;', 'DROP TABLE a;', 'INSERT INTO a VALUES (1);'])('throws on DDL it does not recognise: %s', (sql) => {
    expect(() => schemaStatements(sql)).toThrow(/does not know/);
  });
});
