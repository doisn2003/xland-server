import 'dotenv/config';
import pg from 'pg';
import { databaseTarget } from '../src/config/database-target.js';
import { migrate } from '../src/repositories/migrations.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const target=databaseTarget(process.env, process.env.NODE_ENV==='test');
const pool=new pg.Pool({connectionString:target.connectionString,connectionTimeoutMillis:5000});
try {
  const exists=(await pool.query("SELECT to_regclass('xland_meta.migrations') IS NOT NULL present")).rows[0].present;
  if(exists&&!target.environment.startsWith('test')){
    const file=process.env.MIGRATION_BACKUP_FILE;const expected=process.env.MIGRATION_BACKUP_SHA256;
    if(!file||!expected||createHash('sha256').update(await readFile(file)).digest('hex')!==expected)throw new Error('Existing development DB requires a verified pre-migration backup; use the controlled local provisioner or supply backup file/hash');
  }
  console.log(JSON.stringify({environment:target.environment,targetFingerprint:target.fingerprint,migrations:await migrate(pool)}));
}
finally { await pool.end(); }
