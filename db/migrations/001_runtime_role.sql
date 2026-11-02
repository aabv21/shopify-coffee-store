-- The runtime role n8n's app credential connects as: DML on the tables listed below and nothing
-- else, so no DDL, no TRUNCATE, and no access to n8n's own database. docs/database.md maps every
-- statement the workflow issues to the grant that covers it. db-migrate sets the role's password
-- from APP_RUNTIME_DB_PASSWORD after every run, so this file only creates the role.
\getenv runtime_role APP_RUNTIME_DB_USER

SELECT format('CREATE ROLE %I LOGIN', :'runtime_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role')
\gexec

-- Postgres 15 and later already withhold CREATE on public from PUBLIC; this states it outright.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE n8n FROM :"runtime_role";
GRANT CONNECT ON DATABASE app TO :"runtime_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";

-- intake-order's Record order statement is `INSERT INTO orders (order_id, order_number) VALUES
-- ($1, $2) ON CONFLICT (order_id) DO NOTHING RETURNING order_id`: an INSERT whose conflict check
-- and RETURNING both read the row, so it needs SELECT as well as INSERT. No workflow updates or
-- deletes a row, so this role gets neither.
GRANT SELECT, INSERT ON orders TO :"runtime_role";
