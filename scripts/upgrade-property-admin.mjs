import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parse} from 'dotenv';
import pg from 'pg';
import {databaseTarget} from '../src/config/database-target.ts';
import {migrate} from '../src/repositories/migrations.ts';
import {backupSupabaseMock,restoreLogical} from './backup-local.mjs';
import {localPostgres} from './local-postgres.mjs';

// Back up the explicitly approved development target, rehearse the exact upgrade
// on its restored data, then apply only when --apply is provided. No seed/auth reset.
const env={...process.env,...parse(await readFile('.env.supabase-mock','utf8'))};
const target=databaseTarget(env,false);
if(target.environment!=='supabase_mock')throw new Error('This helper only upgrades the approved Supabase mock target');
const source=new pg.Pool({connectionString:target.connectionString,max:1});
// Older manual releases applied 0018/0019 without recording them in the ledger.
// Reconcile only these two known deltas, after verifying EVERY statement's result.
async function knownManualMigrations(pool){
  const applied=new Set((await pool.query('SELECT id FROM xland_meta.migrations')).rows.map(r=>r.id));
  const constraints=(await pool.query("SELECT c.conrelid::regclass::text relation,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c WHERE c.conrelid IN ('xland.user_contacts'::regclass,'xland.user_profiles'::regclass,'xland.auth_sessions'::regclass) AND c.contype='c'")).rows;
  const definition=(relation,name)=>constraints.find(c=>c.relation===relation&&c.conname===name)?.definition;
  const found=[];
  if(!applied.has('0018_optional_user_profile.sql')){
    const column=(await pool.query("SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='xland' AND table_name='user_contacts' AND column_name='address'")).rows[0];
    if(column){
      assert.deepEqual(column,{data_type:'text',is_nullable:'YES',column_default:null});
      assert.equal(definition('xland.user_contacts','user_contacts_address_check'),'CHECK ((length(address) <= 500))');
      assert.equal(definition('xland.user_profiles','user_profiles_display_name_check'),'CHECK ((length(display_name) <= 100))');
      assert.equal((await pool.query("SELECT has_column_privilege('xland_api','xland.user_contacts','address','UPDATE') AS allowed")).rows[0].allowed,true);
      found.push('0018_optional_user_profile.sql');
    }
  }
  if(!applied.has('0019_permanent_sessions.sql')&&definition('xland.auth_sessions','auth_sessions_check')==='CHECK ((expires_at >= created_at))')found.push('0019_permanent_sessions.sql');
  return found;
}
let reconciled,upToDate=false;
try{
  reconciled=await knownManualMigrations(source);
  const ledger=new Map((await source.query('SELECT id,digest FROM xland_meta.migrations')).rows.map(row=>[row.id,row.digest]));
  const files=(await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql'));
  for(const id of files){
    if(!ledger.has(id))continue;
    const sql=(await readFile(resolve('supabase/migrations',id),'utf8')).replace(/\r\n/g,'\n');
    assert.equal(ledger.get(id),createHash('sha256').update(sql).digest('hex'),'Applied migration checksum mismatch');
  }
  upToDate=files.every(id=>ledger.has(id));
  if(upToDate){
    await source.query('SELECT has_subplots,parent_property_id,commune_code,old_address,address_detail FROM xland.properties LIMIT 0');
    assert.equal((await source.query('SELECT count(*)::int count FROM xland.geo_catalogs WHERE active')).rows[0].count,1);
  }
}finally{await source.end();}
if(upToDate){console.log(JSON.stringify({status:'up_to_date',targetFingerprint:target.fingerprint}));process.exit(0);}
const backup=await backupSupabaseMock(target.connectionString);
const bytes=await readFile(backup.file);
assert.equal(createHash('sha256').update(bytes).digest('hex'),backup.sha256);
const snapshot=JSON.parse(bytes.toString('utf8'));
const local=await localPostgres({directory:resolve('.local/property-upgrade'),port:55449});
const root=new pg.Client({connectionString:local.rootUrl});
let restored,live,stage='restore';
try{
  await root.connect();
  const suffix=randomBytes(6).toString('hex'),name='xland_test_restore_property_'+suffix,owner='xland_upgrade_owner_'+suffix,password=randomBytes(32).toString('base64url');
  // Match managed Supabase's non-superuser migration role. Superuser-only QA
  // would miss the CREATE-schema requirement during ALTER FUNCTION OWNER.
  await root.query(`CREATE ROLE ${owner} LOGIN CREATEROLE NOINHERIT BYPASSRLS PASSWORD '${password}'`);
  for(const role of ['xland_api','xland_auth','xland_payment','xland_maps','xland_seed','xland_admin']){
    if((await root.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)await root.query(`GRANT ${role} TO ${owner} WITH ADMIN TRUE,SET TRUE,INHERIT FALSE`);
  }
  await root.query(`CREATE DATABASE ${name} OWNER ${owner}`);
  const url=new URL(local.rootUrl);url.pathname='/'+name;url.username=owner;url.password=password;
  restored=new pg.Pool({connectionString:url.toString()});
  const baseline=await restored.connect();
  try{
    await baseline.query('BEGIN');
    await baseline.query('CREATE SCHEMA xland_meta; REVOKE ALL ON SCHEMA xland_meta FROM PUBLIC; CREATE TABLE xland_meta.migrations(id text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const migration of snapshot.migrations){
      if(!/^\d+[a-z]?_[a-z0-9_]+\.sql$/.test(migration.id))throw new Error('Invalid snapshot migration name');
      const sql=(await readFile(resolve('supabase/migrations',migration.id),'utf8')).replace(/\r\n/g,'\n');
      assert.equal(createHash('sha256').update(sql).digest('hex'),migration.digest,'Snapshot migration differs from checked-in source');
      await baseline.query(sql);
      await baseline.query('INSERT INTO xland_meta.migrations(id,digest) VALUES($1,$2)',[migration.id,migration.digest]);
    }
    for(const id of reconciled){
      const sql=(await readFile(resolve('supabase/migrations',id),'utf8')).replace(/\r\n/g,'\n');
      await baseline.query(sql);
      await baseline.query('INSERT INTO xland_meta.migrations(id,digest) VALUES($1,$2)',[id,createHash('sha256').update(sql).digest('hex')]);
    }
    await baseline.query('COMMIT');
  }catch(error){await baseline.query('ROLLBACK');throw error;}finally{baseline.release();}
  const restore=await restoreLogical(restored,backup.file);
  stage='rehearse';
  const rehearsed=await migrate(restored);
  assert.equal((await restored.query("SELECT has_schema_privilege('xland_admin','xland','CREATE') AS allowed")).rows[0].allowed,false);
  const original=snapshot.tables.find(t=>t.name==='properties');
  const after=(await restored.query('SELECT * FROM xland.properties')).rows;
  assert.equal(after.length,original.rows.length);
  for(const before of original.rows){
    const row=after.find(p=>p.id===before.id);
    assert.ok(row);
    for(const field of ['id','code','title','category','land_type','province','province_code','district','district_code','commune_name','catalog_version','price_total','area_m2','status','approval_status'])assert.equal(String(row[field]),String(before[field]),`Upgrade changed property ${field}`);
    if(!Object.hasOwn(before,'old_address'))assert.equal(row.old_address,[before.commune_name,before.district,before.province].filter(Boolean).join(', ')||null);
  }
  const catalog=(await restored.query("SELECT kind,count(*)::int AS count FROM xland.geo_locations WHERE catalog_version=(SELECT version FROM xland.geo_catalogs WHERE active) GROUP BY kind ORDER BY kind")).rows;
  assert.deepEqual(catalog,[{kind:'commune',count:3321},{kind:'province',count:34}]);
  const evidence={at:new Date().toISOString(),targetFingerprint:target.fingerprint,backup,restore,reconciled,rehearsed,managedNonSuperuser:true,adminCannotCreateSchemaObjects:true,preservedProperties:after.length,catalog,applied:[]};
  if(process.argv.includes('--apply')){
    stage='reconcile-live-ledger';
    live=new pg.Pool({connectionString:target.connectionString,max:1});
    assert.deepEqual(await knownManualMigrations(live),reconciled);
    const ledger=await live.connect();
    try{
      await ledger.query('BEGIN');await ledger.query('SELECT pg_advisory_xact_lock(783134221)');
      for(const id of reconciled){
        const sql=(await readFile(resolve('supabase/migrations',id),'utf8')).replace(/\r\n/g,'\n');
        await ledger.query('INSERT INTO xland_meta.migrations(id,digest) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[id,createHash('sha256').update(sql).digest('hex')]);
      }
      await ledger.query('COMMIT');
    }catch(error){await ledger.query('ROLLBACK');throw error;}finally{ledger.release();}
    stage='migrate-live';evidence.applied=await migrate(live);
    stage='verify-live';
    evidence.liveProperties=(await live.query('SELECT count(*)::int count FROM xland.properties')).rows[0].count;
    evidence.liveCatalog=(await live.query('SELECT version FROM xland.geo_catalogs WHERE active')).rows[0].version;
  }
  await writeFile('.local/property-upgrade-result.json',JSON.stringify(evidence,null,2),{mode:0o600});
  console.log(JSON.stringify(evidence));
}catch(error){
  console.error(JSON.stringify({status:'failed',stage,code:error.code??'UPGRADE_FAILED',constraint:error.constraint??null,message:error.code&&error.code!=='42501'?'Upgrade failed; source data and backup preserved':error.message}));
  process.exitCode=1;
}finally{await restored?.end();await live?.end();await root.end();await local.stop();}
// embedded-postgres beforeExit otherwise masks a pending exit code.
process.exit(process.exitCode??0);
