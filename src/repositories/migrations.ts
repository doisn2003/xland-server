import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';

export async function migrate(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(783134221)`);
    const existing = await client.query(`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='xland') AS app,
      to_regclass('xland_meta.migrations') IS NOT NULL AS ledger`);
    if (existing.rows[0].app && !existing.rows[0].ledger) throw new Error('Existing XLand schema without migration ledger; manual delta review required');
    await client.query(`CREATE SCHEMA IF NOT EXISTS xland_meta;
      REVOKE ALL ON SCHEMA xland_meta FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS xland_meta.migrations(id text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    for (const file of (await readdir(resolve('supabase/migrations'))).filter(f => f.endsWith('.sql')).sort()) {
      const sql = (await readFile(resolve('supabase/migrations', file), 'utf8')).replace(/\r\n/g,'\n');
      const digest = createHash('sha256').update(sql).digest('hex');
      const prior = await client.query('SELECT digest FROM xland_meta.migrations WHERE id=$1', [file]);
      if (prior.rowCount) {
        if (prior.rows[0].digest !== digest) throw new Error('Applied migration checksum mismatch');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO xland_meta.migrations(id,digest) VALUES($1,$2)', [file,digest]);
      applied.push(file);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
