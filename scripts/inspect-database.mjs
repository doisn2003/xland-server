import 'dotenv/config';
import pg from 'pg';
import { createHash } from 'node:crypto';
const value = process.env.DATABASE_URL;
if (!value) { console.log(JSON.stringify({ configured: false })); process.exitCode = 1; }
else {
  const target = new URL(value);
  const pool = new pg.Pool({ connectionString: value, connectionTimeoutMillis: 5000, query_timeout: 5000, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const result = await client.query(`SELECT current_setting('server_version') AS version,
        current_database() AS database, current_user AS role,
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')) AS existing_table_count,
        EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='xland') AS xland_schema_exists`);
      await client.query('COMMIT');
      console.log(JSON.stringify({ configured: true, targetFingerprint: createHash('sha256').update(target.hostname + target.pathname).digest('hex').slice(0,16),
        environmentLabel: process.env.DATABASE_ENVIRONMENT ?? 'unclassified', readOnly: true, metadata: result.rows[0], writes: 0 }));
    } finally { client.release(); }
  } catch (error) {
    console.log(JSON.stringify({ configured: true, environmentLabel: 'unclassified', readOnly: true, reachable: false, errorCode: error.code ?? 'CONNECTION_FAILED', writes: 0 }));
    process.exitCode = 1;
  } finally { await pool.end(); }
}
