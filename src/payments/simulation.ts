import { createHash,createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../repositories/database.js';
import { DomainError,missing } from '../domain/errors.js';
import { money,uuid,parse } from '../schemas/http.js';

// Internal adapter only. Never imported/mounted by runtime.ts or any HTTP route.
const eventSchema=z.object({eventId:z.string().min(1).max(128),transactionId:z.string().min(1).max(128),intentId:uuid,reference:z.string().min(1).max(128),amountVnd:money.refine(v=>BigInt(v)>0n),currency:z.enum(['VND','USD']),receivedAt:z.iso.datetime({offset:true})}).strict();
export type SimulationEvent=z.infer<typeof eventSchema>;
export interface TestSimulationConfig {
  environment:'isolated-local-test';policyVersion:`TEST-${string}`;amountVnd:string;ttlSeconds:number;
  lateEventTreatment:'needs_review';lateBasis:'received_at';signingKey:Buffer;
}
export function simulationSignature(key:Buffer,event:SimulationEvent):string {
  return createHmac('sha256',key).update(JSON.stringify(parse(eventSchema,event))).digest('base64url');
}
const provider='xland-isolated-simulator';
export class SimulationPayments {
  private constructor(readonly db:Database,readonly config:TestSimulationConfig,readonly now:()=>Date){}
  static async create(db:Database,config:TestSimulationConfig,now:()=>Date=()=>new Date()):Promise<SimulationPayments>{
    if(config.environment!=='isolated-local-test'||!/^TEST-.+/.test(config.policyVersion)||config.signingKey.length<32||!Number.isInteger(config.ttlSeconds)||config.ttlSeconds<1||config.ttlSeconds>3600||config.lateEventTreatment!=='needs_review'||config.lateBasis!=='received_at')throw new Error('Explicit isolated TEST simulation configuration required');
    parse(money.refine(v=>BigInt(v)>0n),config.amountVnd);
    const target=(await db.pool.query('SELECT current_database() name,host(inet_server_addr()) host')).rows[0];
    if(!/^xland_test_/.test(target.name)||!['127.0.0.1','::1'].includes(target.host))throw new Error('Simulation is restricted to an isolated loopback test database');
    return new SimulationPayments(db,config,now);
  }
  async intent(userId:string,bookingId:string):Promise<{id:string;reference:string;expiresAt:Date}> {
    return this.db.transaction('xland_payment',userId,async c=>{
      const booking=(await c.query('SELECT id,user_id,status FROM xland.site_visit_bookings WHERE id=$1 FOR UPDATE',[bookingId])).rows[0];if(!booking||booking.user_id!==userId)missing();
      if(booking.status!=='awaiting_deposit')throw new DomainError(409,'CONFLICT','Simulation booking is not awaiting deposit');
      const existing=(await c.query("SELECT * FROM xland.payment_intents WHERE booking_id=$1 AND mode='simulation' AND status='pending'",[bookingId])).rows[0];
      if(existing){if(existing.amount_vnd!==this.config.amountVnd||existing.policy_version!==this.config.policyVersion)throw new DomainError(409,'CONFLICT','Simulation policy mismatch');return {id:existing.id,reference:existing.reference,expiresAt:existing.expires_at};}
      const id=randomUUID(),reference='SIM-'+randomUUID(),expiresAt=new Date(this.now().getTime()+this.config.ttlSeconds*1000);
      await c.query(`INSERT INTO xland.payment_intents(id,booking_id,user_id,amount_vnd,status,mode,reference,policy_version,provider,expires_at)
        VALUES($1,$2,$3,$4,'pending','simulation',$5,$6,$7,$8)`,[id,bookingId,userId,this.config.amountVnd,reference,this.config.policyVersion,provider,expiresAt]);
      await c.query(`INSERT INTO xland.payment_status_history(id,intent_id,from_status,to_status,source,public_note) VALUES($1,$2,'unpaid','pending','test_simulation','Mô phỏng cô lập, không có chuyển tiền thật')`,[randomUUID(),id]);
      return {id,reference,expiresAt};
    });
  }
  async receive(raw:SimulationEvent,signature:string):Promise<{status:string;receiptId:string|null;duplicate:boolean}> {
    const event=parse(eventSchema,raw);const expected=Buffer.from(simulationSignature(this.config.signingKey,event));const actual=Buffer.from(signature);
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new DomainError(403,'FORBIDDEN','Invalid internal simulation proof');
    const digest=createHash('sha256').update(JSON.stringify(event)).digest('hex');
    return this.db.transaction('xland_payment',null,async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[provider+event.eventId]);
      const prior=(await c.query('SELECT * FROM xland.payment_provider_events WHERE provider=$1 AND mode=$2 AND provider_event_id=$3',[provider,'simulation',event.eventId])).rows[0];
      if(prior){if(prior.payload_digest!==digest)throw new DomainError(409,'CONFLICT','Provider event ID payload mismatch');return {status:prior.processing_status,receiptId:prior.receipt_id,duplicate:true};}
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[provider+event.transactionId]);
      const initial=(await c.query("SELECT booking_id FROM xland.payment_intents WHERE id=$1 AND mode='simulation' AND provider=$2",[event.intentId,provider])).rows[0];if(!initial)missing();
      const booking=(await c.query('SELECT id,status FROM xland.site_visit_bookings WHERE id=$1 FOR UPDATE',[initial.booking_id])).rows[0];
      const intent=(await c.query('SELECT * FROM xland.payment_intents WHERE id=$1 FOR UPDATE',[event.intentId])).rows[0];
      const repeated=(await c.query('SELECT id,intent_id,received_amount_vnd,currency FROM xland.payment_receipts WHERE provider=$1 AND mode=$2 AND provider_transaction_id=$3',[provider,'simulation',event.transactionId])).rows[0];
      if(repeated){
        const same=repeated.intent_id===event.intentId&&repeated.received_amount_vnd===event.amountVnd&&repeated.currency===event.currency&&intent.reference===event.reference;
        await c.query(`INSERT INTO xland.payment_provider_events(id,provider,mode,provider_event_id,receipt_id,payload_digest,processing_status,error_code,processed_at)
          VALUES($1,$2,'simulation',$3,$4,$5,$6,$7,$8)`,[randomUUID(),provider,event.eventId,same?repeated.id:null,digest,same?'duplicate_receipt':'needs_review',same?null:'TRANSACTION_REUSED',this.now()]);
        return {status:same?'duplicate_receipt':'needs_review',receiptId:same?repeated.id:null,duplicate:true};
      }
      const received=new Date(event.receivedAt);
      const reason=event.reference!==intent.reference?'REFERENCE_MISMATCH':event.currency!==intent.currency?'CURRENCY_MISMATCH':event.amountVnd!==intent.amount_vnd?'AMOUNT_MISMATCH':received>intent.expires_at?'LATE_EVENT':received>this.now()?'FUTURE_EVENT':booking.status!=='awaiting_deposit'?'BOOKING_STATE_MISMATCH':intent.status!=='pending'?'INTENT_STATE_MISMATCH':null;
      const status=reason?'needs_review':'succeeded';const receiptId=randomUUID();
      // Receipts store the received currency verbatim. Non-VND proofs are quarantined as events only.
      if(event.currency==='VND')await c.query(`INSERT INTO xland.payment_receipts(id,intent_id,provider,provider_transaction_id,received_amount_vnd,currency,received_at,mode,verification_state)
        VALUES($1,$2,$3,$4,$5,$6,$7,'simulation',$8)`,[receiptId,event.intentId,provider,event.transactionId,event.amountVnd,event.currency,received,reason?'needs_review':'verified']);
      await c.query(`INSERT INTO xland.payment_provider_events(id,provider,mode,provider_event_id,receipt_id,payload_digest,processing_status,error_code,processed_at,redacted_evidence)
        VALUES($1,$2,'simulation',$3,$4,$5,$6,$7,$8,$9)`,[randomUUID(),provider,event.eventId,event.currency==='VND'?receiptId:null,digest,status,reason,this.now(),JSON.stringify({testOnly:true,policyVersion:this.config.policyVersion})]);
      // Additional mismatched deposits after success are reviewed without downgrading a verified payment.
      if(intent.status!=='succeeded'){
        await c.query('UPDATE xland.payment_intents SET status=$1,updated_at=$2 WHERE id=$3',[status,this.now(),intent.id]);
        if(intent.status!==status)await c.query('INSERT INTO xland.payment_status_history(id,intent_id,from_status,to_status,source,public_note) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),intent.id,intent.status,status,'test_verified_event',reason?'Cần kiểm tra mô phỏng':'Mô phỏng đã đối soát']);
      }
      if(!reason){
        await c.query("UPDATE xland.site_visit_bookings SET status='pending_confirmation',updated_at=$1 WHERE id=$2",[this.now(),booking.id]);
        await c.query("UPDATE xland.slot_reservations SET state='deposit_received' WHERE booking_id=$1",[booking.id]);
        await c.query(`INSERT INTO xland.booking_status_history(id,booking_id,from_status,to_status,source,public_note)
          VALUES($1,$2,'awaiting_deposit','pending_confirmation','test_verified_event','Mô phỏng nhận cọc; chờ điều phối xác nhận lịch')`,[randomUUID(),booking.id]);
      }
      return {status,receiptId:event.currency==='VND'?receiptId:null,duplicate:false};
    });
  }
}
