import {readFile,writeFile}from'node:fs/promises';
import {createHash}from'node:crypto';
import {parse}from'dotenv';
import pg from'pg';
const run=JSON.parse(await readFile('.local/w2-run.json','utf8'));
const value=parse(await readFile('.env','utf8')).DATABASE_URL;
const target=new URL(value);const fingerprint=createHash('sha256').update(target.hostname+target.pathname).digest('hex').slice(0,16);
if(fingerprint!=='03d6c297d77a1029')throw new Error('A-09 fingerprint mismatch; no writes');
const pool=new pg.Pool({connectionString:value,max:1,connectionTimeoutMillis:10000,query_timeout:10000});
try{
  const c=await pool.connect();try{
    await c.query('BEGIN READ ONLY');
    const metadata=(await c.query("SELECT current_user role,current_database() database,current_setting('server_version') version,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) superuser,(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) bypass,(SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) create_role")).rows[0];
    const schemas=(await c.query("SELECT nspname name,pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname IN ('public','xland','xland_meta') ORDER BY nspname")).rows;
    const objects=(await c.query("SELECT n.nspname schema,c.relname name,c.relkind kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m') ORDER BY 1,2")).rows;
    const roles=(await c.query("SELECT rolname name,rolsuper superuser,rolbypassrls bypass,rolcanlogin login FROM pg_roles WHERE rolname LIKE 'xland_%' ORDER BY rolname")).rows;
    const ledgerExists=(await c.query("SELECT to_regclass('xland_meta.migrations') IS NOT NULL present")).rows[0].present;
    const ledger=ledgerExists?(await c.query('SELECT id,digest FROM xland_meta.migrations ORDER BY id')).rows:[];
    await c.query('COMMIT');
    const result={timestamp:new Date().toISOString(),environment:'supabase_mock',fingerprint,readOnly:true,writes:0,metadata,schemas,objects,roles,ledger};
    const evidenceFile=run.evidence+'/supabase-preflight-'+Date.now()+'.json';
    await writeFile(evidenceFile,JSON.stringify(result,null,2));
    run.latestPreflight=evidenceFile;await writeFile('.local/w2-run.json',JSON.stringify(run));
    console.log(JSON.stringify({environment:result.environment,fingerprint,readOnly:true,metadata,applicationObjects:objects.filter(o=>['xland','xland_meta','public'].includes(o.schema)),xlandRoles:roles,ledger}));
  }finally{c.release();}
}catch(e){console.error(JSON.stringify({fingerprint,writes:0,errorCode:e.code??'PREFLIGHT_FAILED'}));process.exitCode=1;}finally{await pool.end();}
