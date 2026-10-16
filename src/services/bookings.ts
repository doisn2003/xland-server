import type { PoolClient } from 'pg';
import type { z } from 'zod';
import type { CoreService } from './core.js';
import type { Identity } from './auth.js';
import type { Wire } from '../repositories/properties.js';
import { page,type PageQuery } from '../repositories/page.js';
import type { bookingInput,dates } from '../schemas/http.js';
import { DomainError,missing,invalid } from '../domain/errors.js';

export const depositPolicy:Wire={indicativeAmountVnd:'350000',policyVersion:null,chargeBasis:null,refundPolicyText:null,cancellationPolicyText:null,reschedulePolicyText:null,livePaymentEnabled:false,notice:'Mức cọc: 350.000 VNĐ — chính sách áp dụng đang được hoàn thiện'};
const area=(r:Wire):Wire=>({latitude:Number(r.approximate_meeting_lat),longitude:Number(r.approximate_meeting_lng),radiusM:r.radius_m,label:r.label});
export class BookingService {
  constructor(readonly core:CoreService){}
  slot(r:Wire):Wire {
    const available=r.status==='open'&&(r.starts_at as Date)>this.core.now()&&Number(r.used)<Number(r.max_bookings);
    return {id:r.id,propertyId:r.property_id,consultantId:r.consultant_id,startsAt:(r.starts_at as Date).toISOString(),endsAt:(r.ends_at as Date).toISOString(),timeZone:r.time_zone,isAvailable:available,unavailableReason:available?null:'Khung giờ không còn khả dụng',meetingArea:area(r),maxAttendees:r.max_attendees};
  }
  async availability(identity:Identity|null,id:string,q:z.infer<typeof dates>,consultant=false):Promise<Wire[]> {
    return this.core.read(identity,async c=>{
      if(consultant){if(!(await c.query('SELECT id FROM xland.consultants WHERE id=$1',[id])).rowCount)missing();}
      else {const p=await this.core.properties.get(c,id);if(p.status!=='listed')throw new DomainError(409,'PROPERTY_UNAVAILABLE','Bất động sản chưa nhận lịch');}
      const rows=await c.query(`SELECT s.*,xland.slot_booking_count(s.id) used FROM xland.site_visit_slots s JOIN xland.properties p ON p.id=s.property_id
        WHERE ${consultant?'s.consultant_id':'s.property_id'}=$1 AND p.status='listed' AND s.starts_at>=$2::date AT TIME ZONE 'Asia/Ho_Chi_Minh'
        AND s.starts_at<($3::date+1) AT TIME ZONE 'Asia/Ho_Chi_Minh' AND s.starts_at>$4 ORDER BY s.starts_at,s.id`,[id,q.fromDate,q.toDate,this.core.now()]);
      return rows.rows.map(r=>this.slot(r));
    });
  }
  async get(c:PoolClient,id:string):Promise<Wire> {
    const result=await c.query<Wire>('SELECT * FROM xland.site_visit_bookings WHERE id=$1',[id]);if(!result.rowCount)missing();return this.map(c,result.rows[0]!);
  }
  async map(c:PoolClient,r:Wire):Promise<Wire> {
    const slot=(await c.query('SELECT * FROM xland.site_visit_slots WHERE id=$1',[r.slot_id])).rows[0];
    const payment=(await c.query('SELECT status FROM xland.payment_intents WHERE booking_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[r.id])).rows[0];
    const history=await c.query('SELECT id,from_status,to_status,occurred_at,source,public_note FROM xland.booking_status_history WHERE booking_id=$1 ORDER BY occurred_at,id',[r.id]);
    return {id:r.id,propertyId:r.property_id,sourceVideoId:r.source_video_id,consultantId:r.consultant_id,slotId:r.slot_id,property:await this.core.properties.get(c,String(r.property_id)),
      requestedStartsAt:(r.requested_starts_at as Date).toISOString(),confirmedStartsAt:r.confirmed_starts_at?(r.confirmed_starts_at as Date).toISOString():null,timeZone:r.time_zone,
      proposedMeetingArea:area(slot),confirmedMeetingLabel:r.confirmed_meeting_label,attendeeCount:r.attendee_count,transportMode:r.transport_mode,requestDocuments:r.request_documents,requestLoanAdvice:r.request_loan_advice,
      contactName:r.customer_name,maskedContactPhone:String(r.customer_phone).slice(0,3)+'•• ••• '+String(r.customer_phone).slice(-3),status:r.status,paymentStatus:payment?.status??'unpaid',depositPolicy,
      history:history.rows.map(h=>({id:h.id,fromStatus:h.from_status,toStatus:h.to_status,occurredAt:h.occurred_at.toISOString(),actorLabel:h.source==='customer'?'Khách hàng':'Hệ thống XLand',publicNote:h.public_note})),availableActions:[],
      createdAt:(r.created_at as Date).toISOString(),updatedAt:(r.updated_at as Date).toISOString(),isIllustrative:r.is_illustrative};
  }
  async create(identity:Identity|null,input:z.infer<typeof bookingInput>,key:string):Promise<Wire> {
    this.core.user(identity);
    return this.core.write(identity,c=>this.core.idempotent(c,identity!,'B03',key,input,async()=>{
      const property=await this.core.properties.get(c,input.propertyId);
      if(property.status!=='listed')throw new DomainError(409,'PROPERTY_UNAVAILABLE','Bất động sản chưa nhận lịch');
      if(input.sourceVideoId&&!(await c.query('SELECT id FROM xland.videos WHERE id=$1 AND property_id=$2',[input.sourceVideoId,input.propertyId])).rowCount)invalid('sourceVideoId');
      const slot=(await c.query('SELECT * FROM xland.site_visit_slots WHERE id=$1 AND property_id=$2 FOR UPDATE',[input.slotId,input.propertyId])).rows[0];
      if(!slot||slot.status!=='open'||slot.starts_at<=this.core.now())throw new DomainError(409,'SLOT_UNAVAILABLE','Khung giờ không còn khả dụng');
      if(input.attendeeCount>slot.max_attendees)invalid('attendeeCount');
      const used=(await c.query('SELECT xland.slot_booking_count($1) used',[input.slotId])).rows[0].used;
      if(used>=slot.max_bookings)throw new DomainError(409,'SLOT_UNAVAILABLE','Khung giờ đã đủ lịch');
      const id=this.core.newId();
      await c.query(`INSERT INTO xland.site_visit_bookings(id,user_id,property_id,consultant_id,slot_id,source_video_id,requested_starts_at,attendee_count,transport_mode,request_documents,request_loan_advice,customer_name,customer_phone,note,status,price_snapshot,is_illustrative)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'awaiting_deposit',$15,$16)`,[id,this.core.user(identity),input.propertyId,property.consultantId,input.slotId,input.sourceVideoId??null,slot.starts_at,input.attendeeCount,input.transportMode,input.requestDocuments,input.requestLoanAdvice,input.contactName,input.contactPhone,input.note??null,property.priceTotal,property.isIllustrative]);
      // No expiry is invented: a test/demo pending reservation needs operator policy before live use.
      await c.query("INSERT INTO xland.slot_reservations(booking_id,slot_id,state) VALUES($1,$2,'hold')",[id,input.slotId]);
      await c.query(`INSERT INTO xland.booking_status_history(id,booking_id,from_status,to_status,actor_id,source,public_note)
        VALUES($1,$2,'draft','awaiting_deposit',$3,'customer','Đã nhận yêu cầu xem đất; lịch chưa được xác nhận')`,[this.core.newId(),id,this.core.user(identity)]);
      await c.query("INSERT INTO xland.payment_intents(id,booking_id,user_id,status,mode) VALUES($1,$2,$3,'unpaid','disabled')",[this.core.newId(),id,this.core.user(identity)]);
      return {id,data:await this.get(c,id)};
    }));
  }
  async list(identity:Identity|null,q:PageQuery&{status?:string|undefined}):Promise<Wire>{
    const user=this.core.user(identity);return this.core.read(identity,c=>page(c,this.core.cursor,'bookings',{user,status:q.status??null},q,'t.*','xland.site_visit_bookings t',q.status?'t.status=$1':'true',q.status?[q.status]:[],'t.created_at','DESC','timestamptz',r=>this.map(c,r)));
  }
  async changeGate(identity:Identity|null,id:string):Promise<never>{await this.core.read(identity,c=>{this.core.user(identity);return this.get(c,id);});throw new DomainError(409,'POLICY_NOT_CONFIGURED','Chính sách hủy/đổi lịch chưa được khóa');}
  async payment(c:PoolClient,r:Wire):Promise<Wire> {
    const received=(await c.query('SELECT xland.payment_received_at($1) received',[r.id])).rows[0].received;
    return {id:r.id,bookingId:r.booking_id,amountVnd:r.amount_vnd,status:r.status,mode:r.mode,reference:r.reference,expiresAt:r.expires_at?(r.expires_at as Date).toISOString():null,receivedAt:received?received.toISOString():null,instructions:null,policyVersion:r.policy_version,
      notice:r.mode==='simulation'?'Mô phỏng cô lập; không có chuyển tiền thật':'Thanh toán thật chưa bật, chưa có QR/tài khoản nhận tiền',updatedAt:(r.updated_at as Date).toISOString()};
  }
  async payments(identity:Identity|null,booking:string,q:PageQuery):Promise<Wire>{
    this.core.user(identity);return this.core.read(identity,async c=>{await this.get(c,booking);return page(c,this.core.cursor,'payments',{user:identity!.userId,booking},q,'t.*','xland.payment_intents t','t.booking_id=$1',[booking],'t.created_at','DESC','timestamptz',r=>this.payment(c,r));});
  }
  async getPayment(identity:Identity|null,id:string):Promise<Wire>{this.core.user(identity);return this.core.read(identity,async c=>{const r=(await c.query('SELECT * FROM xland.payment_intents WHERE id=$1',[id])).rows[0];if(!r)missing();return this.payment(c,r);});}
  async paymentGate(identity:Identity|null,id:string):Promise<never>{await this.core.read(identity,c=>{this.core.user(identity);return this.get(c,id);});throw new DomainError(409,'POLICY_NOT_CONFIGURED','Chính sách cọc chưa khóa; livePaymentEnabled=false');}
}
