import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {parse} from 'dotenv';
import pg from 'pg';
import {localPostgres} from './local-postgres.mjs';
import {migrate} from '../src/repositories/migrations.ts';
import {restoreLogical} from './backup-local.mjs';
import {databaseTarget} from '../src/config/database-target.ts';

const file=process.argv[2];if(!file)throw new Error('Pass the pre-admin logical backup path');
const snapshot=JSON.parse(await readFile(file,'utf8'));
const env=parse(await readFile('.env.supabase-mock','utf8')),target=databaseTarget(env,false);
const live=new pg.Pool({connectionString:target.connectionString,max:1});
const local=await localPostgres({directory:resolve('.local/admin-tests'),port:55445});
const root=new pg.Client({connectionString:local.rootUrl});let restored;
try{
  await root.connect();const name='xland_test_restore_admin_'+randomBytes(5).toString('hex');await root.query(`CREATE DATABASE ${name}`);
  const url=new URL(local.rootUrl);url.pathname='/'+name;restored=new pg.Pool({connectionString:url.toString()});await migrate(restored);
  const restore=await restoreLogical(restored,file);
  const preserved={},changes={};
  for(const name of ['properties','property_media','videos','consultants','site_visit_bookings','booking_status_history','support_requests','events','clubs']){
    const table=snapshot.tables.find(t=>t.name===name);
    const cols=table.columns.map(c=>['numeric','bigint','timestamp with time zone','timestamp without time zone','date','time without time zone'].includes(c.type)?`"${c.name}"::text AS "${c.name}"`:`"${c.name}"`).join(',');
    const rows=(await live.query(`SELECT ${cols} FROM xland.${name}`)).rows;
    const digest=rs=>createHash('sha256').update(JSON.stringify(rs.map(r=>JSON.stringify(r)).sort())).digest('hex');
    if(digest(rows)===digest(table.rows))preserved[name]=rows.length;
    else{
      const prior=new Map(table.rows.map(r=>[r.id,r])),current=new Map(rows.map(r=>[r.id,r]));
      changes[name]={before:table.rows.length,after:rows.length,added:rows.filter(r=>!prior.has(r.id)).length,removed:table.rows.filter(r=>!current.has(r.id)).length,
        changed:rows.filter(r=>prior.has(r.id)&&JSON.stringify(r)!==JSON.stringify(prior.get(r.id))).map(r=>({idHash:createHash('sha256').update(r.id).digest('hex').slice(0,12),fields:Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(prior.get(r.id)[k]))}))};
    }
  }
  const evidence={at:new Date().toISOString(),targetFingerprint:target.fingerprint,backupRestore:restore,existingBusinessRowsUnchanged:preserved,concurrentChangesObserved:changes};
  await writeFile('.local/admin-target-verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await restored?.end();await root.end();await local.stop();await live.end();}
process.exit(process.exitCode??0);
