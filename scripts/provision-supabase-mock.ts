import{readFile,writeFile,readdir}from'node:fs/promises';
import{randomBytes,createHash}from'node:crypto';
import{parse}from'dotenv';
import pg from'pg';
import{databaseTarget}from'../src/config/database-target.js';
import{migrate}from'../src/repositories/migrations.js';
import{seed,loadFixture,randomTestAccount,type SeedAccount}from'../src/repositories/seed.js';
import{backupSupabaseMock,restoreLogical}from'./backup-local.mjs';
const run=JSON.parse(await readFile('.local/w2-run.json','utf8')) as {evidence:string;stamp:string;latestPreflight?:string};
const value=parse(await readFile('.env','utf8')).DATABASE_URL!;
const target=databaseTarget({DATABASE_URL:value,DATABASE_ENVIRONMENT:'supabase_mock',DATABASE_APPROVED_FINGERPRINT:'03d6c297d77a1029'},false);
const pool=new pg.Pool({connectionString:value,max:2,connectionTimeoutMillis:10000,query_timeout:30000});
let phase='pre-write-verification';
try{
  const preflight=JSON.parse(await readFile(run.latestPreflight??run.evidence+'/supabase-preflight.json','utf8')) as {objects:unknown[];ledger:unknown[];roles:unknown[]};
  const objects=async()=>(await pool.query("SELECT n.nspname schema,c.relname name,c.relkind kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m') ORDER BY 1,2")).rows;
  const before=await objects();if(JSON.stringify(before)!==JSON.stringify(preflight.objects))throw new Error('Concurrent schema change differs from preflight; investigate before writes');
  const hasLedger=(await pool.query("SELECT to_regclass('xland_meta.migrations') IS NOT NULL present")).rows[0].present;
  if(hasLedger){const current=(await pool.query('SELECT id,digest FROM xland_meta.migrations ORDER BY id')).rows;if(JSON.stringify(current)!==JSON.stringify(preflight.ledger))throw new Error('Concurrent migration ledger change');}
  else if(preflight.roles.length||before.some(r=>r.schema==='xland'||r.schema==='xland_meta'))throw new Error('Unattributed XLand role/schema before initial migration');
  let context:{connectionString:string;first:SeedAccount;second:SeedAccount;runId:string};
  try{context=JSON.parse(await readFile('.local/supabase-mock-context.json','utf8')) as typeof context;if(context.connectionString!==value)throw new Error('Private Supabase context target changed');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    const fixture=await loadFixture();const first={...randomTestAccount(),id:String(fixture.sampleTypes.UserProfile!.id)};first.username='mock-w2-'+randomBytes(6).toString('hex');
    context={connectionString:value,first,second:randomTestAccount(),runId:'c-w2-'+randomBytes(8).toString('hex')};
    await writeFile('.local/supabase-mock-context.json',JSON.stringify(context),{mode:0o600});
  }
  const config={DATABASE_URL:value,DATABASE_ENVIRONMENT:'supabase_mock',DATABASE_APPROVED_FINGERPRINT:target.fingerprint,NODE_ENV:'development',PORT:'3001',CORS_ORIGINS:'http://localhost:5555,http://127.0.0.1:5555',CURSOR_SECRET:randomBytes(32).toString('base64url'),DEMO_USERNAME:context.first.username,DEMO_PASSWORD:context.first.password};
  try{const prior=await readFile('.env.supabase-mock','utf8');if(!prior.startsWith('# XLAND_SUPABASE_MOCK_GENERATED'))throw new Error('Preserve unmanaged Supabase environment');const values=parse(prior);if(values.DATABASE_URL!==value)throw new Error('Supabase environment target changed');config.CURSOR_SECRET=values.CURSOR_SECRET!;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await writeFile('.env.supabase-mock','# XLAND_SUPABASE_MOCK_GENERATED — server/private only\n'+Object.entries(config).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});}
  let backup:null|{sha256:string;format:string;tables:number;restore:unknown}=null;
  if(hasLedger){
    phase='backup-existing-xland-only';const snapshot=await backupSupabaseMock(value);
    const local=JSON.parse(await readFile('.local/cluster.json','utf8')) as {port:number;password:string};const localOptions={host:'127.0.0.1',port:local.port,user:'postgres',password:local.password};const admin=new pg.Pool({...localOptions,database:'postgres'});const name='xland_test_restore_'+randomBytes(8).toString('hex');
    try{await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);}finally{await admin.end();}
    const restorePool=new pg.Pool({...localOptions,database:name});try{await migrate(restorePool);backup={sha256:snapshot.sha256,format:snapshot.format,tables:snapshot.tables,restore:await restoreLogical(restorePool,snapshot.file)};}finally{await restorePool.end();}
  }
  phase='additive-migrations';const applied=await migrate(pool);
  phase='seed-two-runs';const accounts=[context.first,context.second];await seed(pool,accounts);
  const counts=async()=>(await pool.query("SELECT tablename name FROM pg_tables WHERE schemaname='xland' ORDER BY tablename")).rows;
  const tables=await counts();const rowCounts=async()=>{const result:Record<string,number>={};for(const {name}of tables)result[name]=Number((await pool.query(`SELECT count(*) total FROM xland.${name}`)).rows[0].total);return result;};
  const once=await rowCounts();await seed(pool,accounts);const twice=await rowCounts();if(JSON.stringify(once)!==JSON.stringify(twice))throw new Error('Remote seed replay changed counts');
  const outside=(r:{schema:string})=>!['xland','xland_meta'].includes(r.schema);const after=await objects();const outsideUnchanged=JSON.stringify(before.filter(outside))===JSON.stringify(after.filter(outside));if(!outsideUnchanged)throw new Error('Unexpected external metadata change');
  const ledger=(await pool.query('SELECT id,digest FROM xland_meta.migrations ORDER BY id')).rows;
  const sources=await Promise.all((await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort().map(async id=>({id,digest:createHash('sha256').update((await readFile('supabase/migrations/'+id,'utf8')).replace(/\r\n/g,'\n')).digest('hex')})));
  if(JSON.stringify(ledger)!==JSON.stringify(sources))throw new Error('Remote migration hashes differ from source');
  const result={timestamp:new Date().toISOString(),environment:target.environment,fingerprint:target.fingerprint,runId:context.runId,applied,ledger,businessTables:tables.length,once,twice,seedReplayStable:true,outsideNamespaceObjectsUnchanged:outsideUnchanged,backup:backup??{preWriteState:'No XLand schema/data before first write',rollback:'All migrations in one transaction; no DROP/TRUNCATE/reset; internal schemas untouched'},apiBaseUrl:'http://127.0.0.1:3001/api/v1',credentialLocation:'private .env.supabase-mock/.local only'};
  await writeFile(run.evidence+'/supabase-provision-'+Date.now()+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({timestamp:result.timestamp,environment:target.environment,fingerprint:target.fingerprint,applied,businessTables:tables.length,seedReplayStable:true,outsideNamespaceObjectsUnchanged:true,backup}));
}catch(error){const e=error as {code?:string};const failure={timestamp:new Date().toISOString(),environment:target.environment,fingerprint:target.fingerprint,phase,errorCode:e.code??'CONTROLLED_CHECK_FAILED',message:error instanceof Error&&!e.code?error.message:'Database statement rejected; details redacted'};await writeFile(run.evidence+'/supabase-provision-failure-'+Date.now()+'.json',JSON.stringify(failure,null,2));console.error(JSON.stringify(failure));process.exitCode=1;}finally{await pool.end();}
