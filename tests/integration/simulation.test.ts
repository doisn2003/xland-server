import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { testApi } from '../helpers/api.js';
import { SimulationPayments,simulationSignature,type SimulationEvent } from '../../src/payments/simulation.js';
import type { Wire } from '../../src/repositories/properties.js';

test('C8 private payment simulation on PostgreSQL: proof, dedupe, mismatch, late, race and rollback',async t=>{
  const api=await testApi();
  try{
    const f=JSON.parse(await readFile('../brain/logs/agent-c/fixtures/v0.1.json','utf8')) as {sampleTypes:Record<string,Wire>;slots:Wire[]};
    const token=await api.login();let clock=new Date();const signingKey=randomBytes(32);
    const config={environment:'isolated-local-test',policyVersion:'TEST-C8-only',amountVnd:'350000',ttlSeconds:60,lateEventTreatment:'needs_review',lateBasis:'received_at',signingKey} as const;
    const simulation=await SimulationPayments.create(api.db,config,()=>clock);
    const fresh=async()=>{
      const slot=randomUUID();await api.db.pool.query(`INSERT INTO xland.site_visit_slots(id,property_id,consultant_id,starts_at,ends_at,max_attendees,max_bookings,status,approximate_meeting_lat,approximate_meeting_lng,radius_m,label,is_illustrative)
        SELECT $1,property_id,consultant_id,starts_at,ends_at,max_attendees,max_bookings,status,approximate_meeting_lat,approximate_meeting_lng,radius_m,label,is_illustrative FROM xland.site_visit_slots WHERE id=$2`,[slot,f.slots[0]!.id]);
      const response=await api.request('/bookings','POST',{...f.sampleTypes.BookingInput!,slotId:slot},token,randomUUID());assert.equal(response.status,201);const booking=response.body.data as Wire;
      const intent=await simulation.intent(api.context.first.id,String(booking.id));
      const event:SimulationEvent={eventId:randomUUID(),transactionId:randomUUID(),intentId:intent.id,reference:intent.reference,amountVnd:'350000',currency:'VND',receivedAt:clock.toISOString()};
      return {booking,intent,event};
    };
    const receive=(event:SimulationEvent)=>simulation.receive(event,simulationSignature(signingKey,event));
    await t.test('only explicitly configured test adapter; invalid proof has no DB event; public payment remains gated',async()=>{
      await assert.rejects(SimulationPayments.create(api.db,{...config,policyVersion:'live-policy' as `TEST-${string}`}));
      const {booking,event}=await fresh();await assert.rejects(simulation.receive(event,'unverified-proof'));
      assert.equal(Number((await api.db.pool.query('SELECT count(*) count FROM xland.payment_provider_events')).rows[0].count),0);
      const gate=await api.request('/bookings/'+booking.id+'/payment-intents','POST',{},token,randomUUID());assert.equal(gate.status,409);assert.equal((gate.body.error as Wire).code,'POLICY_NOT_CONFIGURED');
    });
    await t.test('verified duplicate event/transaction race produces one receipt and pending confirmation, never confirmed',async()=>{
      const {booking,intent,event}=await fresh();
      const [one,two]=await Promise.all([receive(event),receive(event)]);assert.equal(one.status,'succeeded');assert.equal(two.status,'succeeded');assert.equal(one.receiptId,two.receiptId);assert.equal([one,two].filter(r=>r.duplicate).length,1);
      assert.equal((await receive({...event,eventId:randomUUID()})).status,'duplicate_receipt');
      await assert.rejects(receive({...event,amountVnd:'350001'}),/payload mismatch/);
      const mismatchedTransaction=await receive({...event,eventId:randomUUID(),amountVnd:'350001'});assert.equal(mismatchedTransaction.status,'needs_review');
      assert.equal(Number((await api.db.pool.query('SELECT count(*) count FROM xland.payment_receipts WHERE intent_id=$1',[intent.id])).rows[0].count),1);
      const current=(await api.request('/bookings/'+booking.id,'GET',undefined,token)).body.data as Wire;assert.equal(current.status,'pending_confirmation');assert.equal(current.confirmedStartsAt,null);assert.equal(current.paymentStatus,'succeeded');
      const payment=(await api.request('/payments/'+intent.id,'GET',undefined,token)).body.data as Wire;assert.equal(payment.mode,'simulation');assert.equal(payment.instructions,null);assert.equal(payment.amountVnd,'350000');assert.ok(payment.receivedAt);
      // Explicit server-controlled test coordinator scenario, never a public status endpoint.
      await api.db.transaction('xland_payment',null,async c=>{
        await c.query("UPDATE xland.site_visit_bookings SET status='confirmed',confirmed_starts_at=requested_starts_at WHERE id=$1",[booking.id]);
        await c.query("INSERT INTO xland.booking_status_history(id,booking_id,from_status,to_status,source,public_note) VALUES($1,$2,'pending_confirmation','confirmed','test_coordinator','Kịch bản kiểm thử, không phải lịch thật')",[randomUUID(),booking.id]);
      });
      assert.equal(((await api.request('/bookings/'+booking.id,'GET',undefined,token)).body.data as Wire).status,'confirmed');
    });
    await t.test('distinct signed events racing same provider transaction are deduped',async()=>{
      const {intent,event}=await fresh();const results=await Promise.all([receive(event),receive({...event,eventId:randomUUID()})]);
      assert.deepEqual(results.map(r=>r.status).sort(),['duplicate_receipt','succeeded']);
      assert.equal(Number((await api.db.pool.query('SELECT count(*) count FROM xland.payment_receipts WHERE intent_id=$1',[intent.id])).rows[0].count),1);
    });
    await t.test('amount/reference/currency mismatch and late proof are quarantined without booking promotion',async()=>{
      for(const variant of ['amount','reference','currency','late'] as const){
        const {booking,intent,event}=await fresh();
        const changed={...event,...(variant==='amount'?{amountVnd:'1'}:variant==='reference'?{reference:'SIM-wrong-reference'}:variant==='currency'?{currency:'USD' as const}:{receivedAt:new Date(clock.getTime()+61000).toISOString()})};
        const result=await receive(changed);assert.equal(result.status,'needs_review');
        const state=(await api.db.pool.query('SELECT status,confirmed_starts_at FROM xland.site_visit_bookings WHERE id=$1',[booking.id])).rows[0];assert.equal(state.status,'awaiting_deposit');assert.equal(state.confirmed_starts_at,null);
        assert.equal((await api.db.pool.query('SELECT status FROM xland.payment_intents WHERE id=$1',[intent.id])).rows[0].status,'needs_review');
      }
    });
    await t.test('late processing with on-time received_at follows explicit TEST rule; cancelled booking cannot auto promote',async()=>{
      const {booking,event}=await fresh();clock=new Date(clock.getTime()+120000);
      assert.equal((await receive(event)).status,'succeeded');
      const cancelled=await fresh();await api.db.transaction('xland_payment',null,c=>c.query("UPDATE xland.site_visit_bookings SET status='cancelled' WHERE id=$1",[cancelled.booking.id]));
      assert.equal((await receive(cancelled.event)).status,'needs_review');
      assert.equal((await api.db.pool.query('SELECT status FROM xland.site_visit_bookings WHERE id=$1',[booking.id])).rows[0].status,'pending_confirmation');
    });
    await t.test('forced late transaction failure rolls receipt, history, intent and booking back; retry succeeds',async()=>{
      const {booking,intent,event}=await fresh();
      await api.db.pool.query(`CREATE FUNCTION xland_meta.fail_verified_simulation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.provider_event_id='test-rollback-event' THEN RAISE EXCEPTION 'isolated simulation fault'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_verified_simulation BEFORE INSERT ON xland.payment_provider_events FOR EACH ROW EXECUTE FUNCTION xland_meta.fail_verified_simulation();`);
      await assert.rejects(receive({...event,eventId:'test-rollback-event'}),/isolated simulation fault/);
      assert.equal(Number((await api.db.pool.query('SELECT count(*) count FROM xland.payment_receipts WHERE intent_id=$1',[intent.id])).rows[0].count),0);
      assert.equal((await api.db.pool.query('SELECT status FROM xland.payment_intents WHERE id=$1',[intent.id])).rows[0].status,'pending');
      assert.equal((await api.db.pool.query('SELECT status FROM xland.site_visit_bookings WHERE id=$1',[booking.id])).rows[0].status,'awaiting_deposit');
      assert.equal((await receive(event)).status,'succeeded');
      await assert.rejects(api.db.pool.query("UPDATE xland.payment_receipts SET verification_state='needs_review' WHERE intent_id=$1",[intent.id]),/append only/);
    });
  }finally{await api.close();}
});
