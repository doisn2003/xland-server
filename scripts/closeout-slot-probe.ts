import {readFile,writeFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {Database} from '../src/repositories/database.js';
import {databaseTarget} from '../src/config/database-target.js';
import {resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
const context=JSON.parse(await readFile('.local/closeout-accounts.json','utf8'));
const target=databaseTarget(parse(await readFile('.env.supabase-mock','utf8')),false);
const db=new Database(target.connectionString,1);
try{
 const run=JSON.parse(await readFile('.local/closeout-run.json','utf8'));
 assert(resolve(run.evidence).startsWith(resolve('../brain/logs/agent-c/evidence/P2-CLOSEOUT')+sep),'C closeout evidence namespace required');
 const result=await db.pool.query('SELECT id,property_id,starts_at,ends_at,time_zone,status,max_attendees,max_bookings FROM xland.site_visit_slots WHERE id=$1',[context.slotId]);
 console.log(JSON.stringify({event:'own_labelled_slot_read',rows:result.rows}));
 const api=await db.transaction('xland_api',null,c=>c.query('SELECT id,starts_at,status FROM xland.site_visit_slots WHERE id=$1',[context.slotId]),true);
 console.log(JSON.stringify({event:'api_role_slot_read',rows:api.rows}));
 const date=(result.rows[0].starts_at as Date).toISOString().slice(0,10);
 const same=await fetch('http://127.0.0.1:3001/api/v1/properties/'+result.rows[0].property_id+'/availability?fromDate='+date+'&toDate='+date);
 const from=new Date(Date.parse(date)-86400000).toISOString().slice(0,10),to=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
 const wide=await fetch('http://127.0.0.1:3001/api/v1/properties/'+result.rows[0].property_id+'/availability?fromDate='+from+'&toDate='+to);
 const bounds=await db.transaction('xland_api',null,c=>c.query("SELECT ($1::date AT TIME ZONE 'Asia/Ho_Chi_Minh')::text lower_bound_text, (($1::date+1) AT TIME ZONE 'Asia/Ho_Chi_Minh')::text upper_bound_text,pg_typeof($1::date AT TIME ZONE 'Asia/Ho_Chi_Minh')::text bound_type, ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')::text expected_lower_timestamptz, current_setting('TimeZone') session_zone",[date]),true);
 const evidence={timestamp:new Date().toISOString(),slot:result.rows,apiRoleRead:api.rows,sameDay:{date,status:same.status,body:await same.json()},wide:{from,to,status:wide.status,body:await wide.json()},bounds:bounds.rows,source:'src/services/bookings.ts:23-24',finding:'Same-day query excludes 10:00 VN own synthetic slot; wider range includes it. No API/seed/contract changed. A review required.'};
 await writeFile(run.evidence+'/availability-boundary-'+Date.now()+'.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({event:'availability_boundary_evidence',date,status:same.status,reviewRequired:true}));
}catch{console.error('Redacted slot diagnostic failed');process.exitCode=1;}finally{await db.close();}
