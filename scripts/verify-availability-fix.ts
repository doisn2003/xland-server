import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {parse} from 'dotenv';
import {Database} from '../src/repositories/database.js';
import {databaseTarget} from '../src/config/database-target.js';
import {evidenceDirectory} from '../src/config/evidence.js';
const target=databaseTarget(parse(await readFile('.env.supabase-mock','utf8')),false);assert.equal(target.fingerprint,'03d6c297d77a1029');
const context=JSON.parse(await readFile('.local/closeout-accounts.json','utf8')) as {slotId:string};
const db=new Database(target.connectionString,1);
const child=spawn(process.execPath,['--import','tsx','scripts/closeout-restart-api.ts'],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
let phase='startup';
try{
 const port=await new Promise<number>((ok,fail)=>{const timer=setTimeout(()=>{child.kill();fail(Error('Owned probe startup timeout'));},20000);child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('message',m=>{clearTimeout(timer);ok((m as {port:number}).port);});});
 phase='read-own-slot';const slot=(await db.pool.query("SELECT id,property_id,consultant_id,starts_at,(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS business_date FROM xland.site_visit_slots WHERE id=$1",[context.slotId])).rows[0]!;
 assert(slot.starts_at>new Date(),'Own slot is past: select a current future slot from API, do not reseed');
 const results=[];
 for(const [kind,id]of [['properties',slot.property_id],['consultants',slot.consultant_id]]){
  phase='get-'+kind;
  const path='/api/v1/'+kind+'/'+id+'/availability?fromDate='+slot.business_date+'&toDate='+slot.business_date;
  const r=await fetch('http://127.0.0.1:'+port+path,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);
  const data=(await r.json() as {data:Array<{id:string}>}).data;assert(data.some(s=>s.id===slot.id));results.push({kind,path,status:r.status,data});
 }
 phase='bounds';const bounds=await db.transaction('xland_api',null,c=>c.query("SELECT ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')::text lower_utc,(($1::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')::text upper_exclusive_utc,pg_typeof($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')::text type",[slot.business_date]),true);
 await writeFile((await evidenceDirectory())+'/availability-remote-fixed.json',JSON.stringify({timestamp:new Date().toISOString(),environment:target.environment,fingerprint:target.fingerprint,slot,results,bounds:bounds.rows,sharedPreviewRestarted:false,remoteWrites:false},null,2));
 console.log(JSON.stringify({event:'availability_remote_fixed',propertyAndConsultant:true,day:slot.business_date,status:200,sharedPreviewRestarted:false}));
}catch(e){console.error(JSON.stringify({event:'availability_probe_failed',phase,code:(e as {code?:string}).code??'CHECK_FAILED'}));process.exitCode=1;}finally{
 await new Promise<void>(ok=>{if(child.exitCode!==null){ok();return;}const timer=setTimeout(()=>{child.kill();ok();},15000);child.once('exit',()=>{clearTimeout(timer);ok();});if(child.connected)child.send({action:'stop'});else child.kill();});await db.close();
}
