import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { testApi } from '../helpers/api.js';
import type { Wire } from '../../src/repositories/properties.js';

test('C4–C7 PostgreSQL workflows: atomic inventory, idempotency, privacy and persisted social/account',async t=>{
  const api=await testApi();
  try {
    const f=JSON.parse(await readFile('../brain/logs/agent-c/fixtures/v0.1.json','utf8')) as {properties:Wire[];feedVideos:Wire[];consultants:Wire[];slots:Wire[];futureEvents:Wire[];events:Wire[];clubs:Wire[];sampleTypes:Record<string,Wire>};
    const property=String(f.properties[0]!.id),video=String(f.feedVideos[0]!.id),consultant=String(f.consultants[0]!.id),slot=String(f.slots[0]!.id),event=String(f.futureEvents[0]!.id);
    const a=await api.login();const b=await api.login(api.context.second);
    const error=(r:{body:Wire},code:string)=>assert.equal((r.body.error as Wire).code,code);
    await t.test('strict profile/settings patch, contact verification reset, owner isolation and explicit null',async()=>{
      const before=(await api.request('/me/settings','GET',undefined,a)).body.data as Wire;assert.equal(before.notificationConsent,false);
      const changed=await api.request('/me/settings','PATCH',{notificationConsent:true,feedAutoplay:true,feedMutedByDefault:false},a);assert.equal(changed.status,200);
      assert.equal(((await api.request('/me/settings','GET',undefined,a)).body.data as Wire).notificationConsent,true);
      assert.equal(((await api.request('/me/settings','GET',undefined,b)).body.data as Wire).notificationConsent,false);
      for(const body of [{},{locale:'en_US'},{timeZone:'UTC'},{notificationConsent:'true'}])assert.equal((await api.request('/me/settings','PATCH',body,a)).status,400);
      await api.db.pool.query('UPDATE xland.user_contacts SET phone_verified_at=now() WHERE user_id=$1',[api.context.first.id]);
      const profile=await api.request('/me/profile','PATCH',{displayName:'  Người kiểm thử  ',contactPhone:'0912345678'},a);assert.equal(profile.status,200);
      assert.equal((profile.body.data as Wire).displayName,'Người kiểm thử');assert.equal((profile.body.data as Wire).contactPhone,'+84912345678');assert.equal((profile.body.data as Wire).contactVerified,false);
      assert.equal((await api.request('/me/profile','PATCH',{avatarUrl:'https://unconfigured.example/avatar.png'},a)).status,400);
      assert.equal((await api.request('/me/profile','PATCH',{isVerified:true},a)).status,400);
      const cleared=await api.request('/me/profile','PATCH',{contactPhone:null,avatarUrl:null},a);assert.equal(cleared.status,200);assert.equal((cleared.body.data as Wire).contactPhone,null);
      assert.equal((await api.request('/me/settings?userId='+api.context.second.id,'GET',undefined,a)).status,400);
      assert.equal((await api.request('/clubs/'+f.clubs[0]!.id+'?unknown=true')).status,400);
    });
    await t.test('support received ticket replay persists once; changed payload conflicts; private owner lists',async()=>{
      const body={...f.sampleTypes.SupportRequestInput!};
      const [one,two]=await Promise.all([api.request('/support-requests','POST',body,a,'support-concurrent-0001'),api.request('/support-requests','POST',body,a,'support-concurrent-0001')]);
      assert.equal(one.status,201);assert.equal(two.status,201);assert.deepEqual(one.body,two.body);assert.equal((one.body.data as Wire).status,'received');
      const conflict=await api.request('/support-requests','POST',{...body,message:'Khác nội dung'},a,'support-concurrent-0001');assert.equal(conflict.status,409);error(conflict,'IDEMPOTENCY_CONFLICT');
      assert.equal((await api.request('/support-requests','POST',body,a)).status,400);
      assert.equal((await api.request('/support-requests','POST',{...body,consentToShareContact:false},a,'support-no-consent-001')).status,400);
      assert.equal(((await api.request('/me/support-requests','GET',undefined,a)).body.data as Wire[]).length,1);
      assert.equal(((await api.request('/me/support-requests','GET',undefined,b)).body.data as Wire[]).length,0);
      const cache=(await api.db.pool.query('SELECT response_public FROM xland.idempotency_records WHERE operation=$1',['S01'])).rows[0].response_public;
      assert.ok(!JSON.stringify(cache).includes('0900000678'));assert.ok(!JSON.stringify(cache).includes('contactName'));assert.ok(cache.ciphertext);
    });
    const bookingBody={...f.sampleTypes.BookingInput!};let booking:Wire={};let owner='';let foreign='';let winnerKey='';
    await t.test('availability date bounds + source video validation; booking last-slot race and original retry response',async()=>{
      const start=(await api.db.pool.query('SELECT (starts_at AT TIME ZONE \'Asia/Ho_Chi_Minh\')::date::text date FROM xland.site_visit_slots WHERE id=$1',[slot])).rows[0].date;
      const dates=`fromDate=${start}&toDate=${start}`;
      assert.equal((await api.request('/properties/'+property+'/availability?'+dates)).status,200);
      assert.equal((await api.request('/consultants/'+consultant+'/availability?'+dates)).status,200);
      assert.equal((await api.request('/properties/'+property+'/availability?fromDate=2026-02-30&toDate=2026-03-01')).status,400);
      assert.equal((await api.request('/properties/'+property+'/availability?fromDate=2026-01-01&toDate=2026-02-02')).status,400);
      assert.equal((await api.request('/bookings','POST',{...bookingBody,sourceVideoId:randomUUID()},a,'booking-invalid-video1')).status,400);
      assert.equal((await api.request('/bookings','POST',{...bookingBody,attendeeCount:7},a,'booking-invalid-count1')).status,400);
      const results=await Promise.all([api.request('/bookings','POST',bookingBody,a,'booking-capacity-key01'),api.request('/bookings','POST',bookingBody,b,'booking-capacity-key02')]);
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);const index=results.findIndex(r=>r.status===201);
      owner=index===0?a:b;foreign=index===0?b:a;winnerKey=index===0?'booking-capacity-key01':'booking-capacity-key02';booking=results[index]!.body.data as Wire;
      error(results[1-index]!,'SLOT_UNAVAILABLE');assert.equal(booking.status,'awaiting_deposit');assert.equal(booking.paymentStatus,'unpaid');assert.equal(booking.confirmedStartsAt,null);assert.deepEqual(booking.availableActions,[]);
      assert.ok(!(booking.maskedContactPhone as string).includes('0900000678'));assert.ok(!('contactPhone'in booking));
      const retry=await api.request('/bookings','POST',bookingBody,owner,winnerKey);assert.equal(retry.status,201);assert.deepEqual(retry.body.data,booking);
      assert.equal(Number((await api.db.pool.query('SELECT count(*) count FROM xland.site_visit_bookings')).rows[0].count),1);
      assert.equal(Number((await api.db.pool.query('SELECT count(*) count FROM xland.slot_reservations')).rows[0].count),1);
      const available=(await api.request('/properties/'+property+'/availability?'+dates)).body.data as Wire[];assert.equal(available[0]!.isAvailable,false);
    });
    await t.test('booking/history/payment reads enforce ownership; policy requests never confirm/charge; paid prerequisite DB guard',async()=>{
      const path='/bookings/'+booking.id;assert.equal((await api.request(path,'GET',undefined,owner)).status,200);assert.equal((await api.request(path,'GET',undefined,foreign)).status,404);
      const history=booking.history as Wire[];assert.equal(history.length,1);assert.equal(history[0]!.toStatus,'awaiting_deposit');assert.ok(!JSON.stringify(history).includes('internal_note'));
      assert.equal(((await api.request('/me/bookings','GET',undefined,owner)).body.data as Wire[]).length,1);
      assert.equal(((await api.request('/me/bookings','GET',undefined,foreign)).body.data as Wire[]).length,0);
      for(const [suffix,body]of [['cancellation-requests',{reason:'Yêu cầu thử'}],['reschedule-requests',{reason:'Yêu cầu thử',requestedSlotId:slot}],['payment-intents',{}]] as const){const r=await api.request(path+'/'+suffix,'POST',body,owner,'policy-gate-key-00001');assert.equal(r.status,409);error(r,'POLICY_NOT_CONFIGURED');assert.equal((await api.request(path+'/'+suffix,'POST',body,foreign,'policy-gate-key-00002')).status,404);}
      const payments=await api.request(path+'/payments','GET',undefined,owner);assert.equal(payments.status,200);const payment=(payments.body.data as Wire[])[0]!;assert.equal(payment.mode,'disabled');assert.equal(payment.status,'unpaid');assert.equal(payment.instructions,null);assert.equal(payment.amountVnd,null);
      assert.equal((await api.request('/payments/'+payment.id,'GET',undefined,foreign)).status,404);
      const refreshed=await api.request('/payments/'+payment.id+'/refresh','POST',{},owner);assert.deepEqual(refreshed.body.data,payment);
      assert.equal((await api.request('/payments/'+payment.id+'/refresh','POST',{paid:true},owner)).status,400);
      await assert.rejects(api.db.transaction('xland_api',api.context.first.id,c=>c.query("UPDATE xland.payment_intents SET status='succeeded'")));
      await assert.rejects(api.db.pool.query("UPDATE xland.site_visit_bookings SET status='confirmed',confirmed_starts_at=requested_starts_at WHERE id=$1",[booking.id]),/Verified deposit/);
    });
    await t.test('event last-seat race, pending disabled payment, idempotency and historical registration denial',async()=>{
      await api.db.pool.query('UPDATE xland.events SET max_slots=1 WHERE id=$1',[event]);
      const body={contactName:'Người kiểm thử',contactPhone:'0900000678',attendeeCount:1};
      const results=await Promise.all([api.request('/events/'+event+'/registrations','POST',body,a,'event-final-seat-key01'),api.request('/events/'+event+'/registrations','POST',body,b,'event-final-seat-key02')]);
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);const index=results.findIndex(r=>r.status===201);const token=index===0?a:b;const key=index===0?'event-final-seat-key01':'event-final-seat-key02';
      const result=results[index]!.body.data as Wire;assert.equal(result.status,'pending');assert.equal(result.paymentMode,'disabled');assert.equal(result.ticketPriceVnd,'149000');error(results[1-index]!,'SOLD_OUT');
      assert.deepEqual((await api.request('/events/'+event+'/registrations','POST',body,token,key)).body.data,result);
      error(await api.request('/events/'+event+'/registrations','POST',body,token,'event-second-key-00001'),'CONFLICT');
      const detail=(await api.request('/events/'+event)).body.data as Wire;assert.equal(detail.remainingSlots,0);assert.equal(detail.status,'sold_out');
      assert.equal((await api.request('/events/'+f.events[0]!.id+'/registrations','POST',body,a,'historical-event-00001')).status,409);
      const total=Number((await api.db.pool.query('SELECT sum(attendee_count) total FROM xland.event_registrations WHERE event_id=$1',[event])).rows[0].total);assert.equal(total,1);
      assert.equal(((await api.request('/me/event-registrations','GET',undefined,token)).body.data as Wire[]).length,1);
    });
    await t.test('feed keyset has24 unique IDs, current property identity, following auth, actual like counts and separate saves',async()=>{
      const seen:string[]=[];let cursor:string|null=null;
      do{const r=await api.request('/feed?limit=3'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(r.status,200);seen.push(...(r.body.data as Wire[]).map(v=>String(v.id)));cursor=(r.body.meta as Wire).nextCursor as string|null;}while(cursor);
      assert.equal(seen.length,24);assert.equal(new Set(seen).size,24);
      assert.equal((await api.request('/feed?feedScope=following')).status,401);
      assert.equal(((await api.request('/feed?feedScope=following','GET',undefined,a)).body.data as Wire[]).length,0);
      assert.equal((await api.request('/authors/'+api.context.first.id+'/follow','PUT',undefined,a)).status,409);
      for(let i=0;i<2;i++)assert.equal((await api.request('/authors/'+consultant+'/follow','PUT',undefined,a)).status,200);
      const followed=await api.request('/me/following','GET',undefined,a);assert.equal((followed.body.data as Wire[]).length,1);
      assert.equal(((await api.request('/feed?feedScope=following','GET',undefined,a)).body.data as Wire[]).length,20);
      for(let i=0;i<2;i++){const liked=await api.request('/videos/'+video+'/like','PUT',undefined,a);assert.deepEqual(liked.body.data,{active:true,count:1});}
      assert.deepEqual((await api.request('/videos/'+video+'/like','PUT',undefined,b)).body.data,{active:true,count:2});
      await api.request('/videos/'+video+'/saved','PUT',undefined,a);
      assert.equal(((await api.request('/me/saved-videos','GET',undefined,a)).body.data as Wire[]).length,1);
      assert.equal(((await api.request('/properties?savedOnly=true','GET',undefined,a)).body.data as Wire[]).length,0);
      const detail=(await api.request('/videos/'+video,'GET',undefined,b)).body.data as Wire;assert.equal(detail.isSaved,false);assert.equal((detail.property as Wire).id,property);
      await api.request('/videos/'+video+'/like','DELETE',undefined,b);await api.request('/videos/'+video+'/saved','DELETE',undefined,a);await api.request('/authors/'+consultant+'/follow','DELETE',undefined,a);
      assert.equal(((await api.request('/feed?feedScope=following','GET',undefined,a)).body.data as Wire[]).length,0);
    });
    await t.test('plain comments original replay, tombstone retry, cross-owner denial and deterministic public pages',async()=>{
      const path='/videos/'+video+'/comments';const body={text:'  Tôi cần thông tin thêm  '};
      const created=await api.request(path,'POST',body,a,'comment-idempotent-001');assert.equal(created.status,201);const comment=created.body.data as Wire;assert.equal(comment.text,'Tôi cần thông tin thêm');assert.equal(comment.canDelete,true);
      assert.deepEqual((await api.request(path,'POST',body,a,'comment-idempotent-001')).body,created.body);
      assert.equal((await api.request(path,'POST',{text:'<script>bad</script>'},a,'comment-invalid-00001')).status,400);
      const guest=(await api.request(path)).body.data as Wire[];assert.equal(guest.length,1);assert.equal(guest[0]!.canDelete,false);assert.ok(!JSON.stringify(guest).includes('contactPhone'));
      assert.equal((await api.request(path+'/'+comment.id,'DELETE',undefined,b)).status,404);
      for(let i=0;i<2;i++)assert.equal((await api.request(path+'/'+comment.id,'DELETE',undefined,a)).status,200);
      assert.equal(((await api.request(path)).body.data as Wire[]).length,0);
    });
    await t.test('late failure rolls back complete booking write and idempotency; private RLS and finance delete',async()=>{
      const extra=randomUUID();await api.db.pool.query(`INSERT INTO xland.site_visit_slots(id,property_id,consultant_id,starts_at,ends_at,max_attendees,max_bookings,status,approximate_meeting_lat,approximate_meeting_lng,radius_m,label,is_illustrative)
        SELECT $1,property_id,consultant_id,starts_at,ends_at,max_attendees,max_bookings,status,approximate_meeting_lat,approximate_meeting_lng,radius_m,label,is_illustrative FROM xland.site_visit_slots WHERE id=$2`,[extra,slot]);
      await api.db.pool.query(`CREATE FUNCTION xland_meta.test_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='forced-late-failure01' THEN RAISE EXCEPTION 'isolated test fault'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER test_late_failure BEFORE INSERT ON xland.idempotency_records FOR EACH ROW EXECUTE FUNCTION xland_meta.test_late_failure();`);
      const result=await api.request('/bookings','POST',{...bookingBody,slotId:extra},a,'forced-late-failure01');assert.equal(result.status,500);assert.ok(!JSON.stringify(result.body).includes('isolated test fault'));
      assert.equal(Number((await api.db.pool.query('SELECT count(*) count FROM xland.site_visit_bookings WHERE slot_id=$1',[extra])).rows[0].count),0);
      assert.equal(Number((await api.db.pool.query('SELECT count(*) count FROM xland.slot_reservations WHERE slot_id=$1',[extra])).rows[0].count),0);
      assert.equal(Number((await api.db.pool.query('SELECT count(*) count FROM xland.idempotency_records WHERE key=$1',['forced-late-failure01'])).rows[0].count),0);
      const plan=randomUUID();await api.db.pool.query('INSERT INTO xland.saved_finance_plans(id,user_id,property_id,label,input,price_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[plan,api.context.first.id,property,'Minh họa SPEC-001 chưa khóa',JSON.stringify(f.sampleTypes.SavedFinancePlan!.input),'2400000000']);
      assert.equal(((await api.request('/me/finance-plans','GET',undefined,b)).body.data as Wire[]).length,0);
      assert.equal((await api.request('/me/finance-plans/'+plan,'DELETE',undefined,b)).status,404);
      assert.equal((await api.request('/me/finance-plans/'+plan,'DELETE',undefined,a)).status,200);
      await api.db.transaction('xland_api',api.context.first.id,async c=>{for(const table of ['user_contacts','support_requests','site_visit_bookings','event_registrations','payment_intents']){
        const rows=await c.query(`SELECT user_id FROM xland.${table} WHERE user_id=$1`,[api.context.second.id]);assert.equal(rows.rowCount,0);
      }});
    });
  }finally{await api.close();}
});
