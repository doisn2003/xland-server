import {localPostgres} from '../../scripts/local-postgres.mjs';
import {migrate} from '../../src/repositories/migrations.ts';
import {readFile,readdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import pg from 'pg';

// This runner never loads .env and never uses DATABASE_URL/XLand's shared cluster.
const local=await localPostgres({directory:resolve('.local/login-auth'),port:55441});
const name='xland_test_login_'+randomBytes(6).toString('hex');
const baselineName=name+'_baseline';
const admin=new pg.Client({connectionString:local.rootUrl});
let pool;
let baselinePool;
let testExitCode=1;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`); // name generated here from [a-z0-9_].
  await admin.query(`CREATE DATABASE ${baselineName}`);
  const url=new URL(local.rootUrl);url.pathname='/'+name;
  const baselineUrl=new URL(local.rootUrl);baselineUrl.pathname='/'+baselineName;
  baselinePool=new pg.Pool({connectionString:baselineUrl.toString()});
  // Exercise default-off against the pre-auth-extension schema, never shared DB.
  for(const file of (await readdir(resolve('supabase/migrations'))).filter(f=>f.endsWith('.sql')&&f<'0009').sort()) {
    await baselinePool.query(await readFile(resolve('supabase/migrations',file),'utf8'));
  }
  pool=new pg.Pool({connectionString:url.toString()});
  await migrate(pool);
  const ledger=await pool.query("SELECT id FROM xland_meta.migrations WHERE id='0009_auth_extension.sql'");
  if(ledger.rowCount!==1)throw new Error('Auth integration tests require migration 0009_auth_extension.sql');
  console.log('Migration 0009 and pre-0009 baseline prepared in isolated local test DBs only.');
  const status=await new Promise((done,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/auth/extension.test.ts','tests/auth/runtime.test.ts'],{
      stdio:'inherit',windowsHide:true,env:{...process.env,XLAND_LOGIN_TEST_DB:url.toString(),XLAND_LOGIN_BASELINE_TEST_DB:baselineUrl.toString()}});
    child.once('error',reject);child.once('exit',code=>done(code??1));
  });
  testExitCode=status;
} catch(error) {
  console.error(JSON.stringify({event:'auth_test_failed',code:error.code??'LOCAL_AUTH_TEST_FAILED'}));
} finally {
  await pool?.end();
  await baselinePool?.end();
  // Keep own DB/cluster for inspection. Never drop a shared/computed database.
  await admin.end();
  await local.stop();
}
// embedded-postgres installs a beforeExit(0) handler; preserve the test failure.
process.exit(testExitCode);
