import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  diffGrants,
  isDenied,
  paramCount,
  PROBES,
  probeScript,
  psqlLiteral,
  roleProblems,
  RUNTIME_GRANTS,
  workflowStatements,
  type WorkflowStatement,
} from '../../scripts/check-db.ts';
import { listJsonFiles } from '../../scripts/lib/list-json-files.ts';
import type { WorkflowJson } from '../../scripts/lib/workflow-types.ts';

const readWorkflow = (path: string): WorkflowJson => JSON.parse(readFileSync(path, 'utf8')) as WorkflowJson;

const failed = (stderr: string): { ok: false; stdout: string; stderr: string } => ({ ok: false, stdout: '', stderr });

describe('isDenied', () => {
  it('passes only when psql failed with the exact denial expected', () => {
    expect(isDenied(failed('psql:<stdin>:2: ERROR:  permission denied for schema public\nLINE 1: CREATE TABLE check_db_probe (id int);'), 'permission denied for schema public')).toBe(true);
  });

  it('fails when the statement succeeded, which is what an over-granted role looks like', () => {
    expect(isDenied({ ok: true, stdout: '', stderr: '' }, 'permission denied for schema public')).toBe(false);
  });

  it('fails when psql failed for another reason, so a missing role or a stopped container cannot pass as a denial', () => {
    expect(isDenied(failed('psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  role "app_runtime" does not exist'), 'permission denied for database "n8n"')).toBe(false);
    expect(isDenied(failed('service "postgres" is not running'), 'must be owner of table orders')).toBe(false);
  });
});

describe('diffGrants', () => {
  it('finds nothing when the role holds exactly the listed privileges', () => {
    expect(diffGrants(RUNTIME_GRANTS, ['orders:INSERT', 'orders:SELECT'])).toEqual({ missing: [], extra: [] });
  });

  it('reports a privilege beyond the list, on a listed table or any other', () => {
    expect(diffGrants(RUNTIME_GRANTS, ['orders:INSERT', 'orders:SELECT', 'orders:UPDATE', 'orders:DELETE'])).toEqual({
      missing: [],
      extra: ['orders:DELETE', 'orders:UPDATE'],
    });
  });

  it('reports a listed privilege the role lacks', () => {
    expect(diffGrants(RUNTIME_GRANTS, ['orders:SELECT'])).toEqual({ missing: ['orders:INSERT'], extra: [] });
  });
});

describe('roleProblems', () => {
  it('finds nothing for a role with no attribute, no membership, and only column privileges its table grants cover', () => {
    const facts = ['column:orders:INSERT', 'column:orders:SELECT', 'role exists'];
    expect(roleProblems(facts, RUNTIME_GRANTS)).toEqual([]);
  });

  it('reports each attribute, membership, uncovered column privilege, and TEMP on app', () => {
    const facts = ['attribute:CREATEDB', 'column:orders:UPDATE', 'member of:app', 'role exists', 'temp on app'];
    expect(roleProblems(facts, RUNTIME_GRANTS)).toEqual([
      'holds CREATEDB',
      'has UPDATE on columns of orders',
      'is a member of app',
      'has TEMP on app',
    ]);
  });

  it('reports a missing role instead of passing on an empty fact list', () => {
    expect(roleProblems([], RUNTIME_GRANTS)).toEqual(['the runtime role does not exist']);
  });
});

describe('paramCount', () => {
  it('is the highest $n a query references', () => {
    expect(paramCount('INSERT INTO orders (order_id, order_number) VALUES ($1, $2) ON CONFLICT (order_id) DO NOTHING RETURNING order_id')).toBe(2);
    expect(paramCount("SELECT 'test:' || $1, $1")).toBe(1);
    expect(paramCount('SELECT 1')).toBe(0);
  });
});

describe('psqlLiteral', () => {
  it('quotes a value for a psql meta-command, doubling any single quote', () => {
    expect(psqlLiteral('#1001')).toBe("'#1001'");
    expect(psqlLiteral("it's")).toBe("'it''s'");
  });

  it('refuses a backslash, which psql would read as an escape inside a meta-command argument', () => {
    expect(() => psqlLiteral('a\\nb')).toThrow(/backslash/);
  });
});

describe('workflow statements', () => {
  const statements = workflowStatements(listJsonFiles('workflows').map((path) => ({ file: basename(path), wf: readWorkflow(path) })));
  const key = (s: { file: string; node: string }): string => `${s.file} › ${s.node}`;

  it('finds the one Postgres query node in workflows/: intake-order’s Record order', () => {
    expect(statements.map(key)).toEqual(['intake-order.json › Record order']);
  });

  it('confirms no other workflow issues Postgres SQL of its own', () => {
    for (const path of listJsonFiles('workflows')) {
      const file = basename(path);
      if (file === 'intake-order.json') continue;
      const wf = readWorkflow(path);
      const pgNodes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.postgres' || n.type.toLowerCase().includes('chatmemory'));
      expect(pgNodes, file).toEqual([]);
    }
  });

  it('has exactly one probe per statement, with one value per $n, so a new Postgres node cannot skip the check', () => {
    expect(PROBES.map(key).sort()).toEqual(statements.map(key).sort());
    for (const probe of PROBES) {
      const statement = statements.find((s) => key(s) === key(probe));
      expect(probe.params, key(probe)).toHaveLength(paramCount(statement?.query ?? ''));
    }
  });

  it('runs every probe as the workflow wrote it, inside one transaction it rolls back', () => {
    const script = probeScript(statements, PROBES);
    const lines = script.trimEnd().split('\n');
    expect(lines[0]).toBe('BEGIN;');
    expect(lines.at(-1)).toBe('ROLLBACK;');
    // probeScript trims a trailing `;` from the workflow's own query text before running it, since
    // the script supplies its own terminator via \bind; the stored query itself keeps that `;`.
    for (const statement of statements) expect(script).toContain(`\n${statement.query.trim().replace(/;$/, '')}\n\\bind `);
  });

  it('refuses a probe list that misses a statement', () => {
    const extra: WorkflowStatement = { file: 'new.json', node: 'New query', query: 'SELECT $1' };
    expect(() => probeScript([...statements, extra], PROBES)).toThrow(/new\.json › New query has no probe/);
  });
});

describe('RUNTIME_GRANTS', () => {
  it('covers only orders, with exactly what ON CONFLICT DO NOTHING RETURNING needs', () => {
    expect(RUNTIME_GRANTS).toEqual({ orders: ['SELECT', 'INSERT'] });
  });
});
