import type { PoolClient } from 'pg';
import type { z } from 'zod';
import type { CoreService } from './core.js';
import type { Identity } from './auth.js';
import type { Wire } from '../repositories/properties.js';
import { page,type PageQuery } from '../repositories/page.js';
import type { registrationInput } from '../schemas/http.js';
import { DomainError,missing } from '../domain/errors.js';

export class CommunityService {
  constructor(readonly core:CoreService){}
  async consultant(identity:Identity|null,id:string):Promise<Wire>{return this.core.read(identity,async c=>{
    const r=(await c.query(`SELECT d.*,(SELECT count(*)::int FROM xland.videos WHERE author_id=d.id) videos,
      xland.author_follow_count(d.id)::int followers,EXISTS(SELECT 1 FROM xland.author_follows WHERE author_id=d.id) following,
      (SELECT min(s.starts_at) FROM xland.site_visit_slots s JOIN xland.properties p ON p.id=s.property_id WHERE s.consultant_id=d.id AND p.status='listed' AND s.status='open' AND s.starts_at>$2 AND xland.slot_booking_count(s.id)<s.max_bookings) next_available
      FROM xland.consultants d WHERE d.id=$1`,[id,this.core.now()])).rows[0];if(!r)missing();
    return {id:r.id,name:r.name,role:r.role,location:r.location,isVerified:r.is_verified,avatarUrl:r.avatar_url,coverUrl:r.cover_url,videoCount:r.videos,followerCount:r.followers,rating:r.rating,
      isFollowing:r.following,nextAvailableAt:r.next_available?r.next_available.toISOString():null,supportRecipientLabel:'Đội hỗ trợ XLand (demo)',isIllustrative:r.is_illustrative};
  });}
  async consultantProperties(identity:Identity|null,id:string,q:PageQuery):Promise<Wire>{return this.core.read(identity,async c=>{
    if(!(await c.query('SELECT id FROM xland.consultants WHERE id=$1',[id])).rowCount)missing();
    return page(c,this.core.cursor,'consultant-properties',{user:identity?.userId??null,id},q,'t.id','xland.properties t',"t.consultant_id=$1 AND t.status='listed'",[id],'t.updated_at','DESC','timestamptz',r=>this.core.properties.get(c,String(r.id)));
  });}
  async reviews(identity:Identity|null,id:string,q:PageQuery):Promise<Wire>{return this.core.read(identity,async c=>{
    if(!(await c.query('SELECT id FROM xland.consultants WHERE id=$1',[id])).rowCount)missing();
    return page(c,this.core.cursor,'reviews',{user:identity?.userId??null,id},q,'t.*','xland.consultant_reviews t','t.consultant_id=$1',[id],'t.created_at','DESC','timestamptz',async r=>({id:r.id,consultantId:r.consultant_id,authorDisplayName:r.public_author_label,rating:r.rating,text:r.body,createdAt:(r.created_at as Date).toISOString(),isIllustrative:r.is_illustrative}));
  });}
  async event(c:PoolClient,r:Wire):Promise<Wire>{
    const used=(await c.query('SELECT xland.event_attendee_count($1) used,EXISTS(SELECT 1 FROM xland.saved_events WHERE event_id=$1) saved',[r.id])).rows[0];
    const closed=r.status==='closed'||(r.ends_at as Date)<=this.core.now();
    const remaining=closed||r.status==='cancelled'?0:Math.max(0,Number(r.max_slots)-used.used);
    return {id:r.id,title:r.title,tags:r.tags,media:r.media,startsAt:(r.starts_at as Date).toISOString(),endsAt:(r.ends_at as Date).toISOString(),timeZone:r.time_zone,venueName:r.venue_name,address:r.address,maxSlots:r.max_slots,remainingSlots:remaining,durationMinutes:r.duration_mins,ticketPriceVnd:r.ticket_price,
      status:closed?'closed':r.status==='open'&&remaining===0?'sold_out':r.status,agenda:r.agenda,speakers:r.speakers,benefits:r.benefits,isSaved:used.saved,isIllustrative:r.is_illustrative};
  }
  async get(c:PoolClient,id:string):Promise<Wire>{const r=(await c.query('SELECT * FROM xland.events WHERE id=$1',[id])).rows[0];if(!r)missing();return this.event(c,r);}
  async events(identity:Identity|null,q:PageQuery&{status?:string|undefined},saved=false):Promise<Wire>{
    if(saved)this.core.user(identity);
    return this.core.read(identity,c=>{
      const status=`CASE WHEN t.ends_at<=now() AND t.status<>'cancelled' THEN 'closed' WHEN t.status='open' AND xland.event_attendee_count(t.id)>=t.max_slots THEN 'sold_out' ELSE t.status END`;
      return page(c,this.core.cursor,saved?'saved-events':'events',{user:identity?.userId??null,status:q.status??null},q,'t.*',saved?'xland.events t JOIN xland.saved_events s ON s.event_id=t.id':'xland.events t',q.status?`${status}=$1`:'true',q.status?[q.status]:[],saved?'s.created_at':'t.starts_at',saved?'DESC':'ASC','timestamptz',r=>this.event(c,r));
    });
  }
  async saved(identity:Identity|null,id:string,active:boolean):Promise<Wire>{return this.core.write(identity,async c=>{
    await this.get(c,id);
    if(active)await c.query('INSERT INTO xland.saved_events(user_id,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[this.core.user(identity),id]);
    else await c.query('DELETE FROM xland.saved_events WHERE event_id=$1',[id]);return {active,count:null};
  });}
  registration(r:Wire):Wire{return {id:r.id,eventId:r.event_id,status:r.status,attendeeCount:r.attendee_count,ticketPriceVnd:r.ticket_price_snapshot,paymentMode:r.payment_mode,notice:'Đăng ký demo; kênh thu phí sự kiện chưa chốt',createdAt:(r.created_at as Date).toISOString()};}
  async register(identity:Identity|null,id:string,input:z.infer<typeof registrationInput>,key:string):Promise<Wire>{this.core.user(identity);return this.core.write(identity,c=>this.core.idempotent(c,identity!,'E05',key,{id,...input},async()=>{
    const event=(await c.query('SELECT * FROM xland.events WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!event)missing();
    const existing=await c.query('SELECT id FROM xland.event_registrations WHERE event_id=$1',[id]);
    if(existing.rowCount)throw new DomainError(409,'CONFLICT','Tài khoản đã gửi đăng ký sự kiện');
    if(event.status!=='open'||event.starts_at<=this.core.now())throw new DomainError(409,'SOLD_OUT','Sự kiện không còn nhận đăng ký');
    const used=(await c.query('SELECT xland.event_attendee_count($1) used',[id])).rows[0].used;
    if(used+input.attendeeCount>event.max_slots)throw new DomainError(409,'SOLD_OUT','Sự kiện không còn đủ chỗ');
    const registrationId=this.core.newId();
    const row=(await c.query(`INSERT INTO xland.event_registrations(id,event_id,user_id,attendee_count,contact_name,contact_phone,status,ticket_price_snapshot,payment_mode)
      VALUES($1,$2,$3,$4,$5,$6,'pending',$7,'disabled') RETURNING *`,[registrationId,id,this.core.user(identity),input.attendeeCount,input.contactName,input.contactPhone,event.ticket_price])).rows[0];
    return {id:registrationId,data:this.registration(row)};
  }));}
  async registrations(identity:Identity|null,q:PageQuery):Promise<Wire>{const user=this.core.user(identity);return this.core.read(identity,c=>page(c,this.core.cursor,'registrations',{user},q,'t.*','xland.event_registrations t','true',[],'t.created_at','DESC','timestamptz',async r=>this.registration(r)));}
}
