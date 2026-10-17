import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {testApi} from '../helpers/api.js';
import {BookingService} from '../../src/services/bookings.js';
import {CoreService} from '../../src/services/core.js';
import {evidenceDirectory} from '../../src/config/evidence.js';
import type {Wire} from '../../src/repositories/properties.js';

test('P2-018 business-day half-open boundaries are timestamptz in property/consultant routes and every session zone',async()=>{
 const api=await testApi();
 try{
  const source=(await api.db.pool.query('SELECT * FROM xland.site_visit_slots LIMIT 1')).rows[0]!;
  const day=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  const lower=new Date(day+'T00:00:00+07:00'),upper=new Date(lower.getTime()+86400000);
  const rows:Array<{id:string;instant:string;label:string}>=[];
  for(const [label,offset,status] of [['before',-1,'open'],['midnight',0,'open'],['ten',10*3600000,'open'],['last-minute',86400000-60000,'open'],['upper',86400000,'open'],['closed',12*3600000,'closed'],['full',13*3600000,'open']] as const){
   const id=randomUUID(),instant=new Date(lower.getTime()+offset).toISOString();rows.push({id,instant,label});
   await api.db.pool.query(`INSERT INTO xland.site_visit_slots(id,property_id,consultant_id,starts_at,ends_at,time_zone,max_attendees,max_bookings,status,approximate_meeting_lat,approximate_meeting_lng,radius_m,label,is_illustrative)
    SELECT $1,property_id,consultant_id,$2::timestamptz,$2::timestamptz+interval '90 minutes',time_zone,5,1,$3,approximate_meeting_lat,approximate_meeting_lng,radius_m,$4,true FROM xland.site_visit_slots WHERE id=$5`,[id,instant,status,'P2-018 isolated '+label,source.id]);
  }
  const token=await api.login(),full=rows.find(r=>r.label==='full')!;
  const booking=await api.request('/bookings','POST',{propertyId:source.property_id,slotId:full.id,attendeeCount:1,transportMode:'self_arranged',requestDocuments:false,requestLoanAdvice:false,contactName:'Boundary synthetic',contactPhone:'0900000678'},token,'boundary-capacity-key');assert.equal(booking.status,201);
  const expected=rows.filter(r=>['midnight','ten','last-minute','closed','full'].includes(r.label)).map(r=>r.id);
  const proofs:Wire[]=[];
  for(const zone of ['UTC','America/New_York','Asia/Tokyo']){
   const core=new CoreService(api.db,api.service.auth,api.service.cursor,()=>new Date());
   core.read=async(identity,work)=>api.db.transaction('xland_api',identity?.userId??null,async c=>{await c.query("SELECT set_config('TimeZone',$1,true)",[zone]);return work(c);},true);
   const service=new BookingService(core);
   for(const consultant of [false,true]){
    const result=await service.availability(null,String(consultant?source.consultant_id:source.property_id),{fromDate:day,toDate:day},consultant);
    const actual=result.filter(r=>rows.some(x=>x.id===r.id));assert.deepEqual(new Set(actual.map(r=>r.id)),new Set(expected));
    assert.equal(actual.find(r=>r.id===full.id)!.isAvailable,false);assert.equal(actual.find(r=>r.id===rows.find(x=>x.label==='closed')!.id)!.isAvailable,false);
    proofs.push({zone,consultant,ids:actual.map(r=>r.id),startsAt:actual.map(r=>r.startsAt)});
   }
   const bounds=await api.db.transaction('xland_api',null,async c=>{await c.query("SELECT set_config('TimeZone',$1,true)",[zone]);return c.query("SELECT ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') low,(($1::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') high,pg_typeof($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')::text type",[day]);},true);
   assert.equal(bounds.rows[0].low.toISOString(),lower.toISOString());assert.equal(bounds.rows[0].high.toISOString(),upper.toISOString());assert.equal(bounds.rows[0].type,'timestamp with time zone');
  }
  for(const [route,id] of [['properties',source.property_id],['consultants',source.consultant_id]]){
   const result=await api.request('/'+route+'/'+id+'/availability?fromDate='+day+'&toDate='+day);assert.equal(result.status,200);assert.deepEqual(new Set((result.body.data as Wire[]).filter(r=>rows.some(x=>x.id===r.id)).map(r=>r.id)),new Set(expected));
  }
  const past=new Date(Date.now()-2*86400000).toISOString().slice(0,10);const old=(await api.request('/properties/'+source.property_id+'/availability?fromDate='+past+'&toDate='+past)).body.data as Wire[];assert.equal(old.length,0);
  await api.db.pool.query("UPDATE xland.properties SET status='paused' WHERE id=$1",[source.property_id]);
  assert.equal((await api.request('/properties/'+source.property_id+'/availability?fromDate='+day+'&toDate='+day)).status,409);
  assert.equal(((await api.request('/consultants/'+source.consultant_id+'/availability?fromDate='+day+'&toDate='+day)).body.data as Wire[]).some(r=>rows.some(x=>x.id===r.id)),false);
  assert.equal((await api.request('/me/bookings')).status,401);
  await writeFile((await evidenceDirectory())+'/availability-boundary-fixed.json',JSON.stringify({day,expectedLowerUtc:lower,expectedUpperExclusiveUtc:upper,sqlType:'timestamp with time zone',rows,proofs,apiPropertyAndConsultant:true,capacityAndClosedStatePreserved:true,pastFiltered:true,unlistedFiltered:true,ownerHistoryGuest401:true},null,2));
 }finally{await api.close();}
});
