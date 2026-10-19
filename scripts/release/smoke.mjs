// A21 live HTTPS acceptance. Only two fresh synthetic users and one isolated QA slot.
// No existing user data is reset. All credentials remain local and are never logged.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import pg from 'pg';
import argon2 from 'argon2';
import {databaseTarget} from '../../src/config/database-target.ts';
const origin='https://xland-server-production.up.railway.app';
const checks=[];const started=new Date().toISOString();
function pass(name){checks.push(name);console.log(`PASS ${name}`);}
async function request(path,{token,method='GET',body,key,status=200}={}){
 const response=await fetch(origin+path,{method,signal:AbortSignal.timeout(30000),headers:{
  ...(token?{authorization:`Bearer ${token}`}:{ }),...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const json=await response.json();assert.equal(response.status,status,`${method} ${path}: ${response.status} ${json.error?.code??''}`);return json;
}
const api=(path,options)=>request('/api/v1'+path,options);
await request('/health/live');await request('/health/ready');pass('HTTPS live and database readiness');
const capabilities=(await api('/auth/capabilities')).data;
assert.equal(capabilities.google.enabled,true);assert.equal(capabilities.phoneOtp.enabled,false);pass('Google enabled; phone OTP disabled');
await api('/auth/phone/challenges',{method:'POST',body:{phone:'0900000000'},key:randomUUID(),status:503});pass('Disabled SMS fails closed');
await api('/auth/google/sessions',{method:'POST',body:{idToken:'invalid-test-token'},status:401});pass('Google invalid proof rejected');
await api('/me/profile',{status:401});await api('/me/profile',{token:'A'.repeat(43),status:401});pass('Guest and invalid bearer cannot access private profile');
await api('/properties/not-a-uuid',{status:400});await api('/properties/'+randomUUID(),{status:404});pass('Invalid and absent property IDs');
const properties=(await api('/properties?limit=50')).data;assert(properties.length>=20);pass('Public property catalogue (at least 20)');
const feed=(await api('/feed?limit=3')).data;assert(feed.length>0&&Number.isInteger(feed[0].likeCount));pass('Feed has numeric like counts');
const video=feed[0];const property=properties.find(p=>p.status==='listed');assert(property);
for(const path of [`/properties/${property.id}`,`/properties/${property.id}/legal`,`/properties/${property.id}/area`,`/consultants/${property.consultantId}`,'/events','/clubs','/catalog/locations'])await api(path);
pass('Property/legal/area/consultant/events/clubs/location reads');
const policy=(await api('/booking-deposit-policy')).data;assert.equal(policy.livePaymentEnabled,false);pass('Deposit payment remains disabled');
const map=(await api(`/properties/${property.id}/area-map`)).data;
assert.equal(map.provider,'geoapify');assert.equal(map.availability,'ready');assert(map.externalAreaMapUrl.startsWith('https://www.google.com/maps/'));
assert(map.externalDirectionsUrl.startsWith('https://www.google.com/maps/'));pass('Geoapify area and external Google links');
const z=12,lat=map.publicArea.centerLatitude,lon=map.publicArea.centerLongitude;
const x=Math.floor((lon+180)/360*2**z),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
const tile=await fetch(`${origin}/maps/tiles/${z}/${x}/${y}.png`,{signal:AbortSignal.timeout(30000)});
assert.equal(tile.status,200);assert.equal(Buffer.from(await tile.arrayBuffer()).subarray(0,8).toString('hex'),'89504e470d0a1a0a');pass('Map tile via HTTPS server proxy');
assert(video.media.url.startsWith('https://'));const media=await fetch(video.media.url,{headers:{range:'bytes=0-1023'},signal:AbortSignal.timeout(30000)});
assert.equal(media.status,206);assert((await media.arrayBuffer()).byteLength===1024);pass('Supabase video supports ranged playback');
const config=parse(await readFile('.env.supabase-mock','utf8'));const target=databaseTarget(config,false);assert.equal(target.fingerprint,'03d6c297d77a1029');
const db=new pg.Pool({connectionString:target.connectionString,max:1});
const users=[0,1].map(i=>({id:randomUUID(),username:`a21-${i}-${randomBytes(6).toString('hex')}`,password:randomBytes(24).toString('base64url')}));
const slotId=randomUUID();let bookingId,commentId,tokenA,tokenB;let setup=false;let failure;
await writeFile('.local/release/smoke-accounts.json',JSON.stringify({users,slotId},null,2),{mode:0o600});
try{
 const c=await db.connect();try{
  await c.query('BEGIN');
  for(const [i,user] of users.entries()){
   const hash=await argon2.hash(user.password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
   await c.query("INSERT INTO xland.user_identities(id,username_normalized,password_hash,status) VALUES($1,$2,$3,'active')",[user.id,user.username,hash]);
   await c.query('INSERT INTO xland.user_profiles(id,display_name,is_illustrative) VALUES($1,$2,true)',[user.id,`A21 Internal QA ${i+1}`]);
   await c.query('INSERT INTO xland.user_contacts(user_id) VALUES($1)',[user.id]);
   await c.query('INSERT INTO xland.user_settings(user_id) VALUES($1)',[user.id]);
   await c.query("INSERT INTO xland.user_roles(user_id,role) VALUES($1,'customer')",[user.id]);
  }
  await c.query(`INSERT INTO xland.site_visit_slots(id,property_id,consultant_id,starts_at,ends_at,max_attendees,max_bookings,status,approximate_meeting_lat,approximate_meeting_lng,radius_m,label,is_illustrative)
    VALUES($1,$2,$3,now()+interval '10 days',now()+interval '10 days 90 minutes',2,1,'open',$4,$5,2000,'A21 isolated QA — will be closed',true)`,[slotId,property.id,property.consultantId,lat,lon]);
  await c.query('COMMIT');setup=true;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 tokenA=(await api('/auth/sessions',{method:'POST',body:{username:users[0].username,password:users[0].password}})).data.accessToken;
 tokenB=(await api('/auth/sessions',{method:'POST',body:{username:users[1].username,password:users[1].password}})).data.accessToken;
 assert.equal((await api('/me/profile',{token:tokenA})).data.id,users[0].id);assert.equal((await api('/me/profile',{token:tokenB})).data.id,users[1].id);pass('Two independent real API sessions');
 const oldB=(await api('/me/settings',{token:tokenB})).data;
 await api('/me/settings',{token:tokenA,method:'PATCH',body:{feedAutoplay:false}});
 assert.equal((await api('/me/settings',{token:tokenA})).data.feedAutoplay,false);assert.deepEqual((await api('/me/settings',{token:tokenB})).data,oldB);pass('Settings persist and isolate two owners');
 await api(`/videos/${video.id}/like`,{method:'PUT',body:{},status:401});
 const liked=(await api(`/videos/${video.id}/like`,{token:tokenA,method:'PUT',body:{}})).data;assert.equal(liked.active,true);assert(Number.isInteger(liked.count));
 const likedAgain=(await api(`/videos/${video.id}/like`,{token:tokenA,method:'PUT',body:{}})).data;assert.equal(likedAgain.count,liked.count);
 assert.equal((await api(`/videos/${video.id}`,{token:tokenA})).data.isLiked,true);assert.equal((await api(`/videos/${video.id}`,{token:tokenB})).data.isLiked,false);
 const unliked=(await api(`/videos/${video.id}/like`,{token:tokenA,method:'DELETE'})).data;assert.equal(unliked.active,false);assert.equal(unliked.count,liked.count-1);pass('Likes numeric, durable, idempotent and owner-isolated');
 await api(`/properties/${property.id}/saved`,{token:tokenA,method:'PUT',body:{}});
 assert((await api('/properties?savedOnly=true',{token:tokenA})).data.some(p=>p.id===property.id));assert.equal((await api('/properties?savedOnly=true',{token:tokenB})).data.length,0);
 await api(`/properties/${property.id}/saved`,{token:tokenA,method:'DELETE'});pass('Saved property ownership and removal');
 const commentKey=randomUUID();const commentBody={text:'A21 automated release QA — removed immediately after verification'};
 commentId=(await api(`/videos/${video.id}/comments`,{token:tokenA,method:'POST',body:commentBody,key:commentKey,status:201})).data.id;
 assert.equal((await api(`/videos/${video.id}/comments`,{token:tokenA,method:'POST',body:commentBody,key:commentKey,status:201})).data.id,commentId);
 await api(`/videos/${video.id}/comments/${commentId}`,{token:tokenB,method:'DELETE',status:404});await api(`/videos/${video.id}/comments/${commentId}`,{token:tokenA,method:'DELETE'});pass('Comment replay, ownership and tombstone');
 const bookingKey=randomUUID();const bookingBody={propertyId:property.id,slotId,attendeeCount:1,transportMode:'self_arranged',requestDocuments:false,requestLoanAdvice:false,contactName:'A21 synthetic QA',contactPhone:'0900000000',note:'Automated internal release test. No visit or payment.'};
 const booking=(await api('/bookings',{token:tokenA,method:'POST',body:bookingBody,key:bookingKey,status:201})).data;bookingId=booking.id;
 assert.equal(booking.status,'awaiting_deposit');assert.equal(booking.depositPolicy.livePaymentEnabled,false);
 assert.equal((await api('/bookings',{token:tokenA,method:'POST',body:bookingBody,key:bookingKey,status:201})).data.id,bookingId);
 assert((await api('/me/bookings',{token:tokenA})).data.some(b=>b.id===bookingId));await api(`/bookings/${bookingId}`,{token:tokenB,status:404});pass('Booking creation/replay/history and owner isolation');
 const payments=(await api(`/bookings/${bookingId}/payments`,{token:tokenA})).data;assert.equal(payments[0].mode,'disabled');assert.equal(payments[0].instructions,null);
 await api(`/bookings/${bookingId}/payment-intents`,{token:tokenA,method:'POST',body:{},key:randomUUID(),status:409});pass('Payment intent blocked; no QR or recipient issued');
 await api('/auth/sessions/current',{token:tokenA,method:'DELETE'});await api('/me/profile',{token:tokenA,status:401});pass('Logout revokes server session');
}catch(error){failure=error;}
finally{
 try{if(setup){
  const c=await db.connect();try{
   await c.query('BEGIN');
   const ids=users.map(u=>u.id);
   await c.query("UPDATE xland.user_identities SET status='disabled' WHERE id=ANY($1::uuid[])",[ids]);
   await c.query('UPDATE xland.auth_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=ANY($1::uuid[])',[ids]);
   await c.query('DELETE FROM xland.video_likes WHERE user_id=ANY($1::uuid[])',[ids]);
   await c.query('DELETE FROM xland.saved_properties WHERE user_id=ANY($1::uuid[])',[ids]);
   await c.query('UPDATE xland.video_comments SET deleted_at=coalesce(deleted_at,now()) WHERE author_id=ANY($1::uuid[])',[ids]);
   await c.query("INSERT INTO xland.booking_status_history(id,booking_id,from_status,to_status,source,public_note) SELECT gen_random_uuid(),id,status,'expired','system','A21 QA completed; no real visit or payment' FROM xland.site_visit_bookings WHERE user_id=ANY($1::uuid[]) AND slot_id=$2 AND status<>'expired'",[ids,slotId]);
   await c.query("UPDATE xland.site_visit_bookings SET status='expired',updated_at=now() WHERE user_id=ANY($1::uuid[]) AND slot_id=$2",[ids,slotId]);
   await c.query("UPDATE xland.slot_reservations SET state='released' WHERE slot_id=$1",[slotId]);
   await c.query("UPDATE xland.site_visit_slots SET status='closed' WHERE id=$1",[slotId]);
   await c.query('COMMIT');pass('Synthetic users disabled; sessions revoked; QA hold released; audit preserved');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 }}finally{await db.end();}
}
const report={started,finished:new Date().toISOString(),origin,result:failure?'FAIL':'PASS',checks,syntheticUserIds:users.map(u=>u.id),slotId,bookingId,commentId,nativeGoogleLogin:'PENDING_USER_APK_TEST'};
await writeFile('../brain/logs/agent-a/A21_PHASE4_2026-10-19/https-smoke.json',JSON.stringify(report,null,2));
if(failure)throw failure;
