import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import {parse} from 'dotenv';
import {Database} from '../src/repositories/database.js';
import {databaseTarget} from '../src/config/database-target.js';
type Account={id:string;username:string;password:string};
type Journal={runLabel:string;accounts:Account[];slotId:string;eventId:string;startsAt:string};
const reportMode=process.argv.includes('--report');
const journalPath=reportMode?'.local/p3-report-journal.json':'.local/p3-w1-journal.json';
const inputPath=reportMode?'.local/p3-report-input.json':'.local/p3-w1-input.json';
const authorizationPath=reportMode?'.local/p3-report-authorization.json':'.local/p3-t0-authorization.json';
const context=JSON.parse(await readFile('.local/p3-context.json','utf8'));
const state=JSON.parse(await readFile('.local/p3-preview.json','utf8'));
assert.equal(context.phase,'W1');assert.equal(context.sourceHash,state.sourceHash);assert.equal(context.bundleHash,state.bundleHash);
const reviewPath=resolve('../brain/logs/agent-a/RV-P3-001/REVIEW.md');
const reviewSha256=createHash('sha256').update(await readFile(reviewPath)).digest('hex');
const target=databaseTarget(parse(await readFile('.env.supabase-mock','utf8')),false);assert.equal(target.environment,'supabase_mock');assert.equal(target.fingerprint,'03d6c297d77a1029');
const db=new Database(target.connectionString,2);
let phase='public-canonical-ids';
try{
 const get=async(path:string)=>{const r=await fetch(state.apiBase+path,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);return (await r.json()).data;};
 const property=(await get('/properties?limit=50')).find((p:{code:string})=>p.code==='XL-028');assert(property);
 const video=(await get('/feed?limit=1'))[0];const original=(await get('/events')).find((e:{status:string})=>e.status==='open');assert(original);
 let journal:Journal;
 try{journal=JSON.parse(await readFile(journalPath,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
  const start=new Date(Date.now()+7*86400000);start.setUTCHours(3,0,0,0);
  const runLabel=(reportMode?'c-p3-report-':'c-p3-')+randomBytes(6).toString('hex');journal={runLabel,accounts:[0,1].map(i=>({id:randomUUID(),username:runLabel+'-'+i,password:randomBytes(32).toString('base64url')})),slotId:randomUUID(),eventId:randomUUID(),startsAt:start.toISOString()};
  await writeFile(journalPath,JSON.stringify(journal),{mode:0o600,flag:'wx'});
 }
 assert(journal.runLabel.startsWith('c-p3-'));assert(new Date(journal.startsAt)>new Date(),'Existing fixture past: preserve journal, do not shift inventory');
 phase='own-additive-idempotent-fixtures';
 const hashes=await Promise.all(journal.accounts.map(a=>argon2.hash(a.password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1})));
 const connection=await db.pool.connect();
 try{await connection.query('BEGIN');await connection.query('SET LOCAL ROLE xland_seed');
  for(const [i,a]of journal.accounts.entries()){
   const existing=(await connection.query('SELECT id,username_normalized FROM xland.user_identities WHERE id=$1 OR username_normalized=$2',[a.id,a.username])).rows;assert(existing.every(r=>r.id===a.id&&r.username_normalized===a.username));
   await connection.query("INSERT INTO xland.user_identities(id,username_normalized,password_hash,status) VALUES($1,$2,$3,'active') ON CONFLICT DO NOTHING",[a.id,a.username,hashes[i]]);
   await connection.query('INSERT INTO xland.user_profiles(id,display_name,is_illustrative) VALUES($1,$2,true) ON CONFLICT DO NOTHING',[a.id,reportMode?(i===0?'Minh An (minh họa)':'Ngọc Anh (minh họa)'):journal.runLabel+' owner '+i]);
   await connection.query('INSERT INTO xland.user_contacts(user_id) VALUES($1) ON CONFLICT DO NOTHING',[a.id]);await connection.query('INSERT INTO xland.user_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING',[a.id]);await connection.query("INSERT INTO xland.user_roles(user_id,role) VALUES($1,'customer') ON CONFLICT DO NOTHING",[a.id]);
  }
  const end=new Date(new Date(journal.startsAt).getTime()+90*60000);
  await connection.query(`INSERT INTO xland.site_visit_slots(id,property_id,consultant_id,starts_at,ends_at,max_attendees,max_bookings,status,approximate_meeting_lat,approximate_meeting_lng,radius_m,label,is_illustrative) VALUES($1,$2,$3,$4,$5,5,5,'open',21,105.5,2000,$6,true) ON CONFLICT DO NOTHING`,[journal.slotId,property.id,property.consultantId,journal.startsAt,end,reportMode?'Điểm hẹn Hòa Lạc • DEMO '+journal.runLabel.slice(-4):'Synthetic '+journal.runLabel]);
  const eventStart=new Date(new Date(journal.startsAt).getTime()-(reportMode?6*86400000:0));
  const eventEnd=new Date(eventStart.getTime()+90*60000);
  const agenda=original.agenda.map((item:{startsAt:string})=>({...item,startsAt:new Date(eventStart.getTime()+Date.parse(item.startsAt)-Date.parse(original.startsAt)).toISOString()}));
  await connection.query(`INSERT INTO xland.events(id,title,tags,media,starts_at,ends_at,time_zone,venue_name,address,max_slots,duration_mins,ticket_price,status,agenda,speakers,benefits,is_illustrative) VALUES($1,$2,$11,'[]',$3,$4,'Asia/Ho_Chi_Minh',$5,$6,5,90,$7,'open',$8,$9,$10,true) ON CONFLICT DO NOTHING`,[journal.eventId,reportMode?'X Coffee • Kết nối cùng XLand':'Synthetic '+journal.runLabel,eventStart,eventEnd,original.venueName,original.address,original.ticketPriceVnd,JSON.stringify(agenda),JSON.stringify(original.speakers),JSON.stringify(original.benefits),JSON.stringify(reportMode?['Minh họa','Kết nối']:['DEMO ONLY'])]);
  await connection.query('COMMIT');
 }catch(e){await connection.query('ROLLBACK');throw e;}finally{connection.release();}
 phase='api-availability-and-auth-record';
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(journal.startsAt));
 const slots=await get(`/properties/${property.id}/availability?fromDate=${date}&toDate=${date}`);const slot=slots.find((s:{id:string})=>s.id===journal.slotId);assert(slot?.isAvailable);assert(slot.maxAttendees>=1);
 const event=await get('/events/'+journal.eventId);assert(event.remainingSlots>=1);
 await writeFile(authorizationPath,JSON.stringify({authorized:true,reviewPath,reviewSha256,sourceHash:state.sourceHash,bundleHash:state.bundleHash,backendSourceHash:state.backendSourceHash}),{mode:0o600});
 const [a,b]=journal.accounts;
 await writeFile(inputPath,JSON.stringify({t0Authorized:true,t0ReviewSha256:reviewSha256,runLabel:journal.runLabel,usernameA:a!.username,passwordA:a!.password,usernameB:b!.username,passwordB:b!.password,propertyId:property.id,financePropertyId:property.id,videoId:video.id,slotId:slot.id,slotLabel:slot.meetingArea.label,eventId:event.id,contactPhone:'0900000678'}),{mode:0o600});
 await writeFile(resolve(context.evidence,'w1-fixtures.json'),JSON.stringify({runLabel:journal.runLabel,sourceHash:state.sourceHash,bundleHash:state.bundleHash,reviewSha256,slot,event:{id:event.id,startsAt:event.startsAt,remainingSlots:event.remainingSlots,ticketPriceVnd:event.ticketPriceVnd},propertyId:property.id,videoId:video.id,accounts:'two dedicated synthetic accounts in private journal only',provisioning:'additive/idempotent INSERT ON CONFLICT DO NOTHING; no existing mutation overwritten'},null,2));
 console.log(JSON.stringify({event:'w1_fixtures_and_exact_t0_record_ready',runLabel:journal.runLabel,slotAvailable:true,eventRemaining:event.remainingSlots}));
}catch{console.error(JSON.stringify({event:'w1_fixture_failed',phase,details:'redacted; preserve own journal/inventory'}));process.exitCode=1;}finally{await db.close();}
