import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import { testApi } from '../helpers/api.js';
import { assertWire } from '../helpers/wire.js';
import type { Wire } from '../../src/repositories/properties.js';

test('per-operation C-3 HTTP contract coverage, including explicit policy/dependency gates',async()=>{
  const api=await testApi();
  const records:Record<string,Wire>={};
  try{
    const fixture=JSON.parse(await readFile('../brain/logs/agent-c/fixtures/v0.1.json','utf8')) as {properties:Wire[];feedVideos:Wire[];consultants:Wire[];slots:Wire[];futureEvents:Wire[];clubs:Wire[];documents:Wire[];sampleTypes:Record<string,Wire>};
    const examples=JSON.parse(await readFile('../brain/logs/agent-c/fixtures/operations.v0.1.json','utf8')) as Record<string,Wire>;
    const property=String(fixture.properties[0]!.id),video=String(fixture.feedVideos[0]!.id),consultant=String(fixture.consultants[0]!.id),event=String(fixture.futureEvents[0]!.id),club=String(fixture.clubs[0]!.id),slot=String(fixture.slots[0]!.id);
    let token='';
    const call=async(op:string,path:string,method='GET',body?:unknown,type?:string,expected=200,mode='implemented')=>{
      const r=await api.request(path,method,body,token,randomUUID());assert.equal(r.status,expected,op+': '+JSON.stringify(r.status>=400?r.body.error:'unexpected status'));
      assert.ok(r.headers.get('x-request-id'));assert.equal(r.headers.get('cache-control'),'no-store');
      if(expected>=400){assert.deepEqual(Object.keys(r.body).sort(),['error','requestId']);assert.equal(r.body.requestId,r.headers.get('x-request-id'));assert.ok((r.body.error as Wire).code);}
      else if(type?.startsWith('Page<')){const meta=r.body.meta as Wire;assert.deepEqual(Object.keys(meta).sort(),['hasMore','nextCursor','total']);assert.equal(typeof meta.hasMore,'boolean');assert.ok(meta.nextCursor===null||typeof meta.nextCursor==='string');assertWire(r.body.data,'List<'+type.slice(5,-1)+'>');}
      else if(type)assertWire(r.body.data,type);
      else if(op!=='U01'&&op!=='D01'&&op!=='D02')assert.equal(r.body.data,null,op);
      records[op]={implementation:mode,runtimeTest:'pass',httpStatus:r.status,successPathTested:expected<400,scenario:type??(expected>=400?(r.body.error as Wire).code:'null result')};
      return r.body.data;
    };
    const login=await call('U01','/auth/sessions','POST',{username:api.context.first.username,password:api.context.first.password});
    assert.deepEqual(Object.keys(login as object).sort(),['accessToken','session']);token=(login as {accessToken:string}).accessToken;assert.match(token,/^[A-Za-z0-9_-]{43}$/);assertWire((login as Wire).session,'Session');
    await call('U04','/auth/session','GET',undefined,'Session');await call('U05','/me/profile','GET',undefined,'UserProfile');await call('U06','/me/profile','PATCH',{displayName:'Người dùng demo'},'UserProfile');
    records.U06!.limitation='Dart explicit-null clear pending DELTA-P2-001; HTTP PATCH tested';
    await call('U07','/me/settings','GET',undefined,'UserSettings');await call('U08','/me/settings','PATCH',{notificationConsent:true},'UserSettings');
    const search=await call('D01','/properties');assertWire(search,'List<Property>');await call('D02','/properties/count');
    await call('D03','/catalog/locations','GET',undefined,'FilterCatalog');await call('D04','/properties/'+property,'GET',undefined,'Property');
    await call('D05','/properties/'+property+'/saved','PUT',undefined,'MutationResult');await call('D06','/properties/'+property+'/saved','DELETE',undefined,'MutationResult');await call('D07','/properties/'+property+'/share','GET',undefined,'ShareLink');
    records.D07!.limitation='Test HTTPS host configured; local development host remains gated';
    await call('L01','/properties/'+property+'/legal','GET',undefined,'LegalSummary');
    await call('L02','/properties/'+property+'/documents/'+fixture.documents[1]!.id+'/download','POST',{},undefined,409,'dependency_gate');
    await call('A01','/properties/'+property+'/area','GET',undefined,'AreaInfo');records.A01!.limitation='Approximate fallback; real map provider not configured';
    await call('F01','/feed','GET',undefined,'Page<FeedVideo>');await call('F02','/videos/'+video,'GET',undefined,'FeedVideo');
    await call('F03','/videos/'+video+'/like','PUT',undefined,'MutationResult');await call('F04','/videos/'+video+'/like','DELETE',undefined,'MutationResult');
    const comment=await call('F06','/videos/'+video+'/comments','POST',{text:'Câu hỏi minh họa'},'VideoComment',201) as Wire;
    await call('F05','/videos/'+video+'/comments','GET',undefined,'Page<VideoComment>');await call('F07','/videos/'+video+'/comments/'+comment.id,'DELETE');
    await call('F08','/videos/'+video+'/saved','PUT',undefined,'MutationResult');await call('F10','/me/saved-videos','GET',undefined,'Page<FeedVideo>');await call('F09','/videos/'+video+'/saved','DELETE',undefined,'MutationResult');
    await call('F11','/authors/'+consultant+'/follow','PUT',undefined,'MutationResult');await call('F13','/me/following','GET',undefined,'Page<PublicAuthor>');await call('F12','/authors/'+consultant+'/follow','DELETE',undefined,'MutationResult');await call('F14','/videos/'+video+'/share','GET',undefined,'ShareLink');
    await call('C01','/consultants/'+consultant,'GET',undefined,'Consultant');await call('C02','/consultants/'+consultant+'/videos','GET',undefined,'Page<FeedVideo>');await call('C03','/consultants/'+consultant+'/properties','GET',undefined,'Page<Property>');await call('C04','/consultants/'+consultant+'/reviews','GET',undefined,'Page<ConsultantReview>');
    const date=(await api.db.pool.query("SELECT (starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text date FROM xland.site_visit_slots WHERE id=$1",[slot])).rows[0].date;
    await call('C05','/consultants/'+consultant+`/availability?fromDate=${date}&toDate=${date}`,'GET',undefined,'List<AvailabilitySlot>');
    await call('E01','/events','GET',undefined,'Page<XlandEvent>');await call('E02','/events/'+event,'GET',undefined,'XlandEvent');await call('E03','/events/'+event+'/saved','PUT',undefined,'MutationResult');await call('E07','/me/saved-events','GET',undefined,'Page<XlandEvent>');await call('E04','/events/'+event+'/saved','DELETE',undefined,'MutationResult');
    await call('E05','/events/'+event+'/registrations','POST',{contactName:'Khách demo',contactPhone:'0900000678',attendeeCount:1},'EventRegistration',201);await call('E06','/me/event-registrations','GET',undefined,'Page<EventRegistration>');await call('E08','/events/'+event+'/share','GET',undefined,'ShareLink');
    await call('B01','/properties/'+property+`/availability?fromDate=${date}&toDate=${date}`,'GET',undefined,'List<AvailabilitySlot>');await call('B02','/booking-deposit-policy','GET',undefined,'DepositPolicy');
    const booking=await call('B03','/bookings','POST',fixture.sampleTypes.BookingInput,'Booking',201) as Wire;
    await call('B04','/me/bookings','GET',undefined,'Page<Booking>');await call('B05','/bookings/'+booking.id,'GET',undefined,'Booking');
    await call('B06','/bookings/'+booking.id+'/cancellation-requests','POST',{reason:'Yêu cầu demo'},undefined,409,'policy_gate');await call('B07','/bookings/'+booking.id+'/reschedule-requests','POST',{reason:'Yêu cầu demo',requestedSlotId:slot},undefined,409,'policy_gate');
    const payments=await call('P01','/bookings/'+booking.id+'/payments','GET',undefined,'Page<PaymentRecord>') as Wire[];const payment=payments[0]!;
    await call('P02','/payments/'+payment.id,'GET',undefined,'PaymentRecord');await call('P03','/bookings/'+booking.id+'/payment-intents','POST',{},undefined,409,'policy_gate');await call('P04','/payments/'+payment.id+'/refresh','POST',{},'PaymentRecord');
    records.P04!.limitation='Reads persisted server-verified state; live upstream disabled';
    await call('K01','/clubs','GET',undefined,'Page<Club>');await call('K02','/clubs/'+club,'GET',undefined,'Club');
    await call('S01','/support-requests','POST',fixture.sampleTypes.SupportRequestInput,'SupportRequest',201);await call('S02','/me/support-requests','GET',undefined,'Page<SupportRequest>');
    const finance=fixture.sampleTypes.SavedFinancePlan!.input;
    await call('N01','/finance/estimates','POST',finance,undefined,409,'blocked_SPEC-001');await call('N02','/me/finance-plans','POST',{label:'Minh họa',input:finance},undefined,409,'blocked_SPEC-001');
    const plan=randomUUID();await api.db.pool.query('INSERT INTO xland.saved_finance_plans(id,user_id,property_id,label,input,price_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[plan,api.context.first.id,property,'Fixture minh họa chưa có result',JSON.stringify(finance),'2400000000']);
    await call('N03','/me/finance-plans','GET',undefined,'Page<SavedFinancePlan>');await call('N04','/me/finance-plans/'+plan,'DELETE');await call('U03','/auth/sessions/current','DELETE');
    const active=Object.entries(examples).filter(([,v])=>v.lifecycle==='active_contract').map(([id])=>id).sort();assert.deepEqual(Object.keys(records).sort(),active);assert.equal(active.length,63);
    const report={timestamp:new Date().toISOString(),contractRevision:'C-3',contractSha256:createHash('sha256').update(await readFile('../brain/02_API_CONTRACT.md')).digest('hex'),environment:'isolated-local-test PostgreSQL17.10',activeOperations:63,successPathTested:Object.values(records).filter(r=>r.successPathTested).length,gatedOrBlocked:Object.values(records).filter(r=>!r.successPathTested).length,notImplemented:['U02 reserved; no route'],operations:Object.fromEntries(Object.entries(records).sort(([a],[b])=>a.localeCompare(b))),limitations:['No live payment, real media/playback/map/document source or production share route acceptance','No calculator formula/rounding until SPEC-001','HTTP contract checks do not imply UI/P3 E2E or G2 acceptance']};
    await writeFile('../brain/logs/agent-c/evidence/P2/operation-coverage.json',JSON.stringify(report,null,2));
    console.log(`C-3 coverage: ${report.successPathTested} success paths, ${report.gatedOrBlocked} explicit gates; U02 reserved; no claim of63success APIs.`);
  }finally{await api.close();}
});
