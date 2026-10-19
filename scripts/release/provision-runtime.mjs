// A-21: provision a dedicated, nonowner runtime login for the approved Supabase pilot.
// No application data is written; no migration/seed or existing credential rotation.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {parse} from 'dotenv';
import pg from 'pg';
import {databaseTarget} from '../../src/config/database-target.ts';
import {Database} from '../../src/repositories/database.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const privateDir=resolve(root,'.local/release');
const evidence=resolve(root,'../brain/logs/agent-a/A21_PHASE4_2026-10-19');
await mkdir(privateDir,{recursive:true});await mkdir(evidence,{recursive:true});
const base=parse(await readFile(resolve(root,'.env.supabase-mock'),'utf8'));
const target=databaseTarget(base,false);assert.equal(target.fingerprint,'03d6c297d77a1029');
const admin=new pg.Pool({connectionString:target.connectionString,max:1});
const credentialsFile=resolve(privateDir,'runtime-login.json');
const role='xland_runtime_internal';
let credentials,db;
try {
  try {await access(credentialsFile);credentials=JSON.parse(await readFile(credentialsFile,'utf8'));}
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    if((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)throw new Error('Existing runtime role requires its private credential backup');
    credentials={role,password:randomBytes(32).toString('hex')};
    await writeFile(credentialsFile,JSON.stringify(credentials,null,2),{flag:'wx',mode:0o600});
  }
  assert.equal(credentials.role,role);assert.match(credentials.password,/^[a-f0-9]{64}$/);
  if(!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount) {
    const c=await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(`CREATE ROLE ${role} LOGIN PASSWORD '${credentials.password}' NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 16`);
      await c.query(`GRANT xland_api,xland_auth,xland_maps TO ${role} WITH INHERIT FALSE, SET TRUE`);
      await c.query('COMMIT');
    } catch(error) {await c.query('ROLLBACK');throw error;} finally {c.release();}
  }
  const url=new URL(target.connectionString);
  const originalUser=decodeURIComponent(url.username);
  const poolerSuffix=originalUser.startsWith('postgres.')?originalUser.slice('postgres'.length):'';
  assert(originalUser==='postgres'||poolerSuffix.startsWith('.'));
  url.username=role+poolerSuffix;url.password=credentials.password;
  db=new Database(url.toString(),1);
  const rights=(await db.pool.query('SELECT rolsuper,rolinherit,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert(rights&&Object.values(rights).every(value=>value===false));
  await assert.rejects(db.pool.query('SELECT id FROM xland.properties'));
  await assert.rejects(db.pool.query('SELECT password_hash FROM xland.user_identities'));
  await assert.rejects(db.pool.query('SET ROLE xland_seed'));
  await assert.rejects(db.pool.query('SET ROLE xland_payment'));
  assert.equal(await db.ready(),true);
  const guests=await db.transaction('xland_api',null,c=>c.query('SELECT user_id FROM xland.user_settings'),true);
  assert.equal(guests.rowCount,0);
  const owners=(await admin.query('SELECT user_id FROM xland.user_settings ORDER BY user_id LIMIT 2')).rows;
  for(const owner of owners) {
    const settings=await db.transaction('xland_api',owner.user_id,c=>c.query('SELECT user_id FROM xland.user_settings'),true);
    assert.equal(settings.rowCount,1);assert.equal(settings.rows[0].user_id,owner.user_id);
    await assert.rejects(db.transaction('xland_api',owner.user_id,c=>c.query('SELECT lat,lng FROM xland.properties'),true));
  }
  await db.transaction('xland_auth',null,c=>c.query('SELECT id FROM xland.user_identities LIMIT 1'),true);
  await db.transaction('xland_maps',null,c=>c.query('SELECT usage_day FROM xland.map_daily_usage LIMIT 1'),true);
  const reset=(await db.pool.query("SELECT current_user role,current_setting('xland.user_id',true) id")).rows[0];
  assert.equal(reset.role,role);assert(!reset.id);
  const auth=parse(await readFile(resolve(root,'.env.auth'),'utf8'));
  const maps=parse(await readFile(resolve(root,'.env.geoapify'),'utf8'));
  const env={NODE_ENV:'production',PORT:'8080',BIND_HOST:'0.0.0.0',DATABASE_URL:url.toString(),
    DATABASE_ENVIRONMENT:'supabase_mock',DATABASE_APPROVED_FINGERPRINT:target.fingerprint,CURSOR_SECRET:base.CURSOR_SECRET,
    XLAND_API_MODE:'api',XLAND_GOOGLE_LOGIN_ENABLED:auth.XLAND_GOOGLE_LOGIN_ENABLED,GOOGLE_AUTH_AUDIENCES:auth.GOOGLE_AUTH_AUDIENCES,
    XLAND_PHONE_OTP_ENABLED:'false',SMS_BRANDNAME_APPROVED:'false',MAPS_EMBED_ENABLED:'false',
    MAPS_GEOAPIFY_ENABLED:maps.MAPS_GEOAPIFY_ENABLED,MAPS_GEOAPIFY_API_KEY:maps.MAPS_GEOAPIFY_API_KEY,
    MAPS_GEOAPIFY_DAILY_CREDITS:'2400',CORS_ORIGINS:'',TRUST_PROXY_HOPS:'1',XLAND_RELEASE_VERSION:'0.2.0-internal.2'};
  assert(env.CURSOR_SECRET?.length>=32&&env.GOOGLE_AUTH_AUDIENCES&&env.MAPS_GEOAPIFY_API_KEY);
  await writeFile(resolve(privateDir,'railway-variables.json'),JSON.stringify(env,null,2),{mode:0o600});
  const report={time:new Date().toISOString(),targetFingerprint:target.fingerprint,role,rights,ownersChecked:owners.length,
    bareAccessDenied:true,seedAndPaymentDenied:true,ownerGuestIsolation:true,exactCoordinatesDenied:true,authAndMapsRolesVerified:true,
    poolResetVerified:true,existingCredentialsRotated:false,applicationRowsWritten:0,variableNames:Object.keys(env)};
  await writeFile(resolve(evidence,'runtime-db.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch(error) {
  console.error(JSON.stringify({event:'runtime_provision_failed',code:error.code??'CONTROLLED_CHECK_FAILED',reason:error instanceof assert.AssertionError?'ASSERTION_FAILED':undefined}));process.exitCode=1;
} finally {await db?.close();await admin.end();}
