import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {parse} from 'dotenv';
import pg from 'pg';
import {databaseTarget} from '../src/config/database-target.ts';
import {migrate} from '../src/repositories/migrations.ts';
import {backupSupabaseMock,restoreLogical} from './backup-local.mjs';
import {localPostgres} from './local-postgres.mjs';

// A-20 user-authorized named-area feature, additive schema only. No mock location guesses.
const env=parse(await readFile('.env.supabase-mock','utf8'));
const target=databaseTarget(env,false);
if(target.environment!=='supabase_mock')throw new Error('Expected approved Supabase mock target');
const pool=new pg.Pool({connectionString:target.connectionString,max:2,connectionTimeoutMillis:10000});
let local,restorePool,admin;
try {
  const ledger=(await pool.query('SELECT id,digest FROM xland_meta.migrations ORDER BY id')).rows;
  const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
  for(const entry of ledger) {
    const text=(await readFile('supabase/migrations/'+entry.id,'utf8')).replace(/\r\n/g,'\n');
    if(createHash('sha256').update(text).digest('hex')!==entry.digest)throw new Error('Migration checksum mismatch');
  }
  const pending=files.filter(f=>!ledger.some(e=>e.id===f));
  if(pending.length===0){console.log(JSON.stringify({alreadyApplied:true}));}
  else {
    if(pending.some(file=>!['0010_named_area_maps.sql','0011_named_area_projection.sql'].includes(file)))throw new Error('Unexpected pending migrations');
    const backup=await backupSupabaseMock(target.connectionString);
    if(createHash('sha256').update(await readFile(backup.file)).digest('hex')!==backup.sha256)throw new Error('Backup verification failed');
    local=await localPostgres({directory:resolve('.local/maps-tests'),port:55442});
    const name='xland_test_restore_maps_'+randomBytes(6).toString('hex');
    admin=new pg.Client({connectionString:local.rootUrl});await admin.connect();await admin.query(`CREATE DATABASE ${name}`);
    const restoreUrl=new URL(local.rootUrl);restoreUrl.pathname='/'+name;
    restorePool=new pg.Pool({connectionString:restoreUrl.toString()});await migrate(restorePool);
    const restored=await restoreLogical(restorePool,backup.file);
    const applied=await migrate(pool);
    const evidence={time:new Date().toISOString(),targetFingerprint:target.fingerprint,applied,
      backupSha256:backup.sha256,restored,locationRowsChanged:0,oldDataPreserved:true};
    const directory=resolve('../brain/logs/agent-a/A20_2026-10-19');await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,'migration-'+applied.at(-1)+'.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify(evidence));
  }
} catch(error) {
  console.error(JSON.stringify({event:'a20_migration_failed',code:error.code??'CONTROLLED_CHECK_FAILED'}));process.exitCode=1;
} finally {await restorePool?.end();await admin?.end();await local?.stop();await pool.end();}
process.exit(process.exitCode??0);
