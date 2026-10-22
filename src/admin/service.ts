import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {Database} from '../repositories/database.js';
import type {Identity} from '../services/auth.js';
import {DomainError,missing} from '../domain/errors.js';
import {automatic,entities,enums,references,type Entity} from './catalog.js';

type Row=Record<string,unknown>;
export interface Field {name:string;type:string;required:boolean;readonly:boolean;defaultValue:unknown;options?:string[]|undefined;reference?:string|undefined;precision:number|null;scale:number|null}
function readColumns(fields:Field[]){return fields.map(f=>{const name='"'+f.name.replaceAll('"','""')+'"';return f.type==='date'?`${name}::text AS ${name}`:name;}).join(',');}
function fail(field:string,message='Kiểm tra thông tin đầu vào'):never {throw new DomainError(400,'INVALID_INPUT',message,[{field,code:'INVALID_VALUE'}]);}
function conflict(message:string):never {throw new DomainError(409,'CONFLICT',message);}
const content=z.string().max(10000);
const https=z.url().refine(v=>new URL(v).protocol==='https:');
const namedDetail=z.object({title:content,description:content}).passthrough();
const jsonLists:Record<string,z.ZodType>={
  highlights:z.array(namedDetail),benefits:z.array(namedDetail),tags:z.array(content),activities:z.array(content),
  agenda:z.array(z.object({startsAt:z.iso.datetime({offset:true}),title:content,description:content.nullable().optional()}).passthrough()),
  speakers:z.array(z.object({name:content,role:content,avatarUrl:https.nullable(),description:content.nullable().optional()}).passthrough()),
  media:z.array(z.object({id:z.string().min(1),kind:z.enum(['image','video']),url:https.nullable(),thumbnailUrl:https.nullable(),durationSeconds:z.number().int().nonnegative().nullable(),altText:content,isIllustrative:z.boolean()}).passthrough()),
};
export class AdminService {
  constructor(readonly db:Database){}
  entity(key:string):Entity {if(!Object.hasOwn(entities,key))missing();return entities[key]!;}
  async transaction<T>(identity:Identity,work:(c:PoolClient)=>Promise<T>){
    try{return await this.db.transaction('xland_admin',identity.userId,async c=>{
      if(!(await c.query("SELECT 1 FROM xland.user_roles WHERE user_id=$1 AND role='admin'",[identity.userId])).rowCount)throw new DomainError(403,'ADMIN_REQUIRED','Tài khoản không có quyền quản trị');
      return work(c);
    });}catch(error){
      const e=error as {code?:string;column?:string};
      if(e.code==='23505')conflict('Mã hoặc thứ tự đã tồn tại. Vui lòng chọn giá trị khác.');
      if(e.code==='23503')fail(e.column??'reference','Liên kết không hợp lệ hoặc đang được sử dụng.');
      if(['23514','23502','22P02','22003','22007','22008'].includes(e.code??''))fail(e.column??'record','Dữ liệu không thỏa mãn ràng buộc của hồ sơ. Kiểm tra số liệu, ngày giờ và các trường liên quan.');
      throw error;
    }
  }
  async fields(c:PoolClient,key:string):Promise<Field[]>{
    const e=this.entity(key);
    const rows=(await c.query(`SELECT column_name,data_type,is_nullable,column_default,is_generated,numeric_precision,numeric_scale
      FROM information_schema.columns WHERE table_schema='xland' AND table_name=$1 ORDER BY ordinal_position`,[e.table])).rows;
    return rows.map(r=>{
      let value:unknown=null;
      if(r.column_default==='false')value=false;else if(r.column_default==='true')value=true;
      else if(r.column_default?.startsWith("'[]'"))value=[];
      else if(r.column_default?.startsWith("'"))value=r.column_default.split("'")[1];
      else if(r.column_default&&/^\d+$/.test(r.column_default))value=Number(r.column_default);
      const readonly=automatic.has(r.column_name)||r.is_generated!=='NEVER'||!!e.readonly?.includes(r.column_name)||(e.edit!==undefined&&!e.edit.includes(r.column_name));
      return {name:r.column_name,type:r.data_type,required:r.is_nullable==='NO',readonly,defaultValue:value,options:enums[key+'.'+r.column_name]??enums[r.column_name],reference:references[r.column_name],precision:r.numeric_precision,scale:r.numeric_scale};
    });
  }
  async schema(identity:Identity){return this.transaction(identity,async c=>{
    const result:Record<string,unknown>={};
    for(const [key,e] of Object.entries(entities))result[key]={...e,fields:await this.fields(c,key)};
    return result;
  });}
  async overview(identity:Identity){return this.transaction(identity,async c=>({
    counts:(await c.query(`SELECT (SELECT count(*)::int FROM xland.properties) properties,
      (SELECT count(*)::int FROM xland.videos WHERE deleted_at IS NULL) videos,
      (SELECT count(*)::int FROM xland.consultants) consultants,
      (SELECT count(*)::int FROM xland.site_visit_bookings WHERE status NOT IN ('completed','cancelled','expired','rejected','no_show')) bookings,
      (SELECT count(*)::int FROM xland.support_requests WHERE status IN ('received','pending')) support`)).rows[0],
    recent:(await c.query('SELECT * FROM xland.admin_audit_log ORDER BY created_at DESC,id DESC LIMIT 8')).rows,
  }));}
  async list(identity:Identity,key:string,q:{q?:string|undefined;page:number;limit:number;filter?:string|undefined;value?:string|undefined}){
    const e=this.entity(key);
    return this.transaction(identity,async c=>{
      const args:unknown[]=[];const where:string[]=[];
      if(q.q){args.push('%'+q.q.replace(/[\\%_]/g,'\\$&')+'%');where.push('('+e.search.map(s=>`"${s}" ILIKE $1`).join(' OR ')+')');}
      if(q.filter){if(!e.filter?.includes(q.filter)||!q.value)fail('filter');args.push(q.value);where.push(`"${q.filter}"::text=$${args.length}`);}
      const clause=where.length?'WHERE '+where.join(' AND '):'';
      const total=Number((await c.query(`SELECT count(*) n FROM xland.${e.table} ${clause}`,args)).rows[0].n);
      const fields=await this.fields(c,key);const order=fields.some(f=>f.name==='created_at')?'created_at DESC,id DESC':'id DESC';
      const rows=(await c.query(`SELECT ${readColumns(fields)},xmin::text AS _version FROM xland.${e.table} ${clause} ORDER BY ${order} LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,q.limit,(q.page-1)*q.limit])).rows;
      for(const col of e.columns){const ref=references[col];if(!ref)continue;const target=this.entity(ref),label=target.search[0]??'id';
        const ids=rows.map(r=>r[col]).filter(Boolean);if(!ids.length)continue;
        const names=(await c.query(`SELECT id,"${label}"::text label FROM xland.${target.table} WHERE id=ANY($1::uuid[])`,[ids])).rows;
        for(const row of rows)row._labels={...row._labels,[col]:names.find(n=>n.id===row[col])?.label??row[col]};
      }
      return {items:rows,total,page:q.page,limit:q.limit};
    });
  }
  async get(identity:Identity,key:string,id:string){return this.transaction(identity,async c=>{
    const e=this.entity(key),fields=await this.fields(c,key);const row=(await c.query(`SELECT ${readColumns(fields)},xmin::text AS _version FROM xland.${e.table} WHERE id=$1`,[id])).rows[0];if(!row)missing();
    if(key==='videos')row.media=(await c.query('SELECT * FROM xland.property_media WHERE id=$1',[row.media_id])).rows[0];
    if(key==='consultants')row.contact=(await c.query('SELECT phone,email_contact FROM xland.user_contacts WHERE user_id=$1',[id])).rows[0];
    if(key==='bookings'){
      row.history=(await c.query('SELECT * FROM xland.booking_status_history WHERE booking_id=$1 ORDER BY occurred_at,id',[id])).rows;
      row.payments=(await c.query('SELECT id,status,mode,amount_vnd FROM xland.payment_intents WHERE booking_id=$1',[id])).rows;
    }
    return row;
  });}
  async lookup(identity:Identity,key:string,q:string,id?:string){return this.transaction(identity,async c=>{
    const e=this.entity(key),label=e.search[0]??'id';
    return (await c.query(`SELECT id,"${label}"::text label FROM xland.${e.table} WHERE ($1='' OR "${label}"::text ILIKE $2 OR id::text=$1) OR id::text=$3 ORDER BY (id::text=$3) DESC,"${label}",id LIMIT 50`,[q,'%'+q.replace(/[\\%_]/g,'\\$&')+'%',id??''])).rows;
  });}
  async locations(identity:Identity){return this.transaction(identity,async c=>(await c.query('SELECT * FROM xland.geo_locations ORDER BY catalog_version DESC,kind,name')).rows);}
  private validate(fields:Field[],input:Row,create:boolean):Row{
    const out:Row={};
    for(const [name,value] of Object.entries(input)){
      const f=fields.find(f=>f.name===name);if(!f||f.readonly)fail(name,'Trường này không được phép chỉnh sửa');
      if(value===null){if(f.required)fail(name,'Thông tin bắt buộc chưa được điền');out[name]=null;continue;}
      if(f.options&&!f.options.includes(String(value)))fail(name);
      if(f.type==='boolean'){if(typeof value!=='boolean')fail(name);}
      else if(f.type==='jsonb'){
        if(!Array.isArray(value))fail(name,'Nhập một danh sách JSON hợp lệ');
        if(JSON.stringify(value).length>20000)fail(name);
        if(jsonLists[name]&&!jsonLists[name]!.safeParse(value).success)fail(name,'Cấu trúc danh sách chưa đúng định dạng của ứng dụng');
      }else if(['numeric','bigint','integer'].includes(f.type)){
        const raw=String(value);if(!/^-?\d+(\.\d+)?$/.test(raw)||!Number.isFinite(Number(raw)))fail(name);
        const [whole,fraction='']=raw.replace('-','').split('.');
        if(f.type!=='numeric'&&fraction)fail(name);
        if(f.type==='numeric'&&f.precision!==null&&((whole?.replace(/^0+/,'').length??0)>f.precision-(f.scale??0)||fraction.length>(f.scale??0)))fail(name,'Số vượt quá độ chính xác cho phép');
        if(f.type==='integer'&&!Number.isSafeInteger(Number(raw)))fail(name);
      }else {
        if(typeof value!=='string'||value.includes('\0')||value.length>10000||(f.required&&!value.trim()))fail(name);
        if(f.type==='uuid'&&!z.uuid().safeParse(value).success)fail(name);
        if(f.type==='timestamp with time zone'&&(!/T.*(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))))fail(name,'Ngày giờ phải có múi giờ');
        if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))fail(name);
        if(name.endsWith('_url')&&value){try{if(new URL(value).protocol!=='https:')fail(name,'URL phải dùng HTTPS');}catch{fail(name);}}
      }
      out[name]=value;
    }
    if(create)for(const f of fields)if(!f.readonly&&f.required&&!(f.name in out)){if(f.defaultValue!==null)out[f.name]=f.defaultValue;else fail(f.name,'Thông tin bắt buộc chưa được điền');}
    return out;
  }
  private async write(c:PoolClient,table:string,id:string,data:Row,create:boolean){
    const keys=Object.keys(data);if(!keys.length)fail('record');
    const values=keys.map(k=>Array.isArray(data[k])?JSON.stringify(data[k]):data[k]);
    if(create)await c.query(`INSERT INTO xland.${table}(id,${keys.map(k=>`"${k}"`).join(',')}) VALUES($1,${keys.map((_,i)=>'$'+(i+2)).join(',')})`,[id,...values]);
    else await c.query(`UPDATE xland.${table} SET ${keys.map((k,i)=>`"${k}"=$${i+2}`).join(',')} WHERE id=$1`,[id,...values]);
  }
  async save(identity:Identity,key:string,input:Row,id?:string){
    const e=this.entity(key),create=!id;if(create&&!e.create)throw new DomainError(405,'READ_ONLY','Không hỗ trợ tạo hồ sơ tại đây');
    if(!create&&e.edit?.length===0)throw new DomainError(405,'READ_ONLY','Dữ liệu chỉ đọc');
    return this.transaction(identity,async c=>{
      const recordId=id??randomUUID();const fields=await this.fields(c,key);
      const {_version,contact,reason,...payload}=input;
      const media=key==='videos'?payload.media:undefined;
      if(key==='videos')delete payload.media;
      let prior:Row|undefined;
      if(!create){
        prior=(await c.query(`SELECT *,xmin::text AS _version FROM xland.${e.table} WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!prior)missing();
        if(!_version||_version!==prior._version)conflict('Hồ sơ đã thay đổi. Tải lại trước khi lưu.');
      }
      if(key==='videos'&&media){
        if(typeof media!=='object'||Array.isArray(media))fail('media');
        const mediaId=prior?String(prior.media_id):randomUUID();
        if(prior&&payload.property_id!==undefined&&payload.property_id!==prior.property_id)fail('property_id','Không thể chuyển video đã đăng sang lô khác');
        const values=this.validate(await this.fields(c,'media'),{...(media as Row),property_id:payload.property_id??prior?.property_id,kind:'video',usage:'feed'},true);
        if(!values.public_url||!values.storage_key)fail('media.public_url','Vui lòng tải video lên Supabase Storage');
        if(prior&&(await c.query('SELECT id FROM xland.videos WHERE media_id=$1 AND id<>$2',[mediaId,id])).rowCount)conflict('Media đang được dùng chung. Hãy tạo video mới để thay nội dung.');
        await this.write(c,'property_media',mediaId,values,!prior);payload.media_id=mediaId;
      }else if(key!=='videos'&&media!==undefined)fail('media');
      if(contact!==undefined&&key!=='consultants')fail('contact');
      if(reason!==undefined&&key!=='bookings')fail('reason');
      const data=this.validate(fields,payload,create);
      const merged={...prior,...data};
      if(key==='properties'){
        if(Number(merged.area_m2)<=0)fail('area_m2','Diện tích phải lớn hơn 0');
        const locations=(await c.query('SELECT code,kind,name,parent_code FROM xland.geo_locations WHERE catalog_version=$1 AND code=ANY($2::text[])',[merged.catalog_version,[merged.province_code,merged.district_code]])).rows;
        const province=locations.find(l=>l.kind==='province'&&l.code===merged.province_code),district=locations.find(l=>l.kind==='district'&&l.code===merged.district_code&&l.parent_code===merged.province_code);
        if(!province||!district)fail('district_code','Tỉnh/thành và quận/huyện phải thuộc cùng danh mục');
        data.province=province.name;data.district=district.name;
        if((merged.lat==null)!==(merged.lng==null))fail('lat','Điền cả vĩ độ và kinh độ chính xác');
        const approx=[merged.approximate_lat,merged.approximate_lng,merged.approximate_radius_m];if(approx.some(v=>v!=null)&&!approx.every(v=>v!=null))fail('approximate_lat','Điền đủ tọa độ và bán kính công khai');
      }
      if(key==='videos'){
        const m=(await c.query("SELECT id FROM xland.property_media WHERE id=$1 AND property_id=$2 AND kind='video' AND usage='feed' AND public_url IS NOT NULL",[merged.media_id,merged.property_id])).rows[0];
        if(!m)fail('media_id','Video phải liên kết media video/feed của chính lô đất');
      }
      if(key==='media'&&prior){
        const used=(await c.query('SELECT id FROM xland.videos WHERE media_id=$1',[id])).rowCount;
        if(used&&(merged.kind!=='video'||merged.usage!=='feed'||merged.property_id!==prior.property_id))conflict('Media đang gắn với video feed; không thể đổi loại hoặc lô đất.');
      }
      if(key==='documents'&&merged.access_level!=='public_redacted'&&merged.storage_key&&!String(merged.storage_key).startsWith('xland-admin-documents/'))fail('storage_key','Tài liệu hạn chế truy cập phải được tải vào kho riêng tư bằng form này');
      if(key==='slots'&&prior){
        const used=(await c.query("SELECT count(*)::int n FROM xland.slot_reservations WHERE slot_id=$1 AND state<>'released'",[id])).rows[0].n;
        if(used&&(String(merged.starts_at)!==String(prior.starts_at)||String(merged.ends_at)!==String(prior.ends_at)||merged.property_id!==prior.property_id)){
          // Compare instants: JSON dates differ from pg Date objects in representation.
          if(Date.parse(String(merged.starts_at))!==Date.parse(String(prior.starts_at))||Date.parse(String(merged.ends_at))!==Date.parse(String(prior.ends_at))||merged.property_id!==prior.property_id)conflict('Khung giờ đã có lịch hẹn; chỉ có thể đóng nhận lịch mới.');
        }
        const attendees=(await c.query("SELECT coalesce(max(b.attendee_count),0) n FROM xland.site_visit_bookings b JOIN xland.slot_reservations r ON r.booking_id=b.id WHERE r.slot_id=$1 AND r.state<>'released'",[id])).rows[0].n;
        if(Number(merged.max_bookings)<used||Number(merged.max_attendees)<attendees)conflict('Sức chứa thấp hơn số khách/lịch hiện có');
      }
      if(key==='events'&&prior){
        const count=(await c.query("SELECT coalesce(sum(attendee_count),0) n FROM xland.event_registrations WHERE event_id=$1 AND status IN ('pending','registered')",[id])).rows[0].n;
        if(Number(merged.max_slots)<Number(count))conflict('Sức chứa thấp hơn số người đã đăng ký');
      }
      if(key==='consultants'){
        // Authentication tables are provisioned inside the SAME transaction, then role restored.
        await c.query('SET LOCAL ROLE xland_auth');
        if(create){
          await c.query('INSERT INTO xland.user_identities(id) VALUES($1)',[recordId]);
          await c.query('INSERT INTO xland.user_profiles(id,display_name,avatar_url,is_verified,public_role,is_illustrative) VALUES($1,$2,$3,$4,$5,$6)',[recordId,data.name,data.avatar_url??null,data.is_verified,data.role,data.is_illustrative]);
          await c.query('INSERT INTO xland.user_settings(user_id) VALUES($1)',[recordId]);
          await c.query('INSERT INTO xland.user_contacts(user_id) VALUES($1)',[recordId]);
          await c.query("INSERT INTO xland.user_roles(user_id,role) VALUES($1,'consultant')",[recordId]);
        }else await c.query('UPDATE xland.user_profiles SET display_name=$2,avatar_url=$3,is_verified=$4,public_role=$5,updated_at=now() WHERE id=$1',[recordId,merged.name,merged.avatar_url,merged.is_verified,merged.role]);
        if(contact!==undefined){
          const parsed=z.object({phone:z.string().regex(/^(\+[1-9][0-9]{8,14}|0[0-9]{9})$/).nullable(),email_contact:z.email().nullable()}).strict().safeParse(contact);
          if(!parsed.success)fail('contact','Kiểm tra số điện thoại và email');
          await c.query('UPDATE xland.user_contacts SET phone=$2,email_contact=$3,updated_at=now() WHERE user_id=$1',[recordId,parsed.data.phone,parsed.data.email_contact]);
        }
        await c.query('SET LOCAL ROLE xland_admin');
      }
      if(key==='bookings'&&prior)await this.bookingChange(c,identity,prior,merged,reason);
      if(fields.some(f=>f.name==='updated_at'))data.updated_at=new Date();
      await this.write(c,e.table,recordId,data,create);
      await this.audit(c,identity,create?'create':'update',key,recordId,[...Object.keys(data).filter(k=>k!=='updated_at'),...(media?['media']:[]),...(contact?['contact']:[])]);
      return (await c.query(`SELECT ${readColumns(fields)},xmin::text AS _version FROM xland.${e.table} WHERE id=$1`,[recordId])).rows[0];
    });
  }
  private async bookingChange(c:PoolClient,identity:Identity,b:Row,next:Row,reason:unknown){
    const transitions:Record<string,string[]>={draft:['cancelled','rejected'],awaiting_deposit:['cancelled','rejected','expired'],pending_confirmation:['confirmed','rejected','cancelled'],confirmed:['completed','no_show','cancelled'],cancel_requested:['cancelled'],reschedule_requested:['cancelled','rejected']};
    if(b.status===next.status)return;
    if(!transitions[String(b.status)]?.includes(String(next.status)))conflict('Không thể chuyển sang trạng thái này từ trạng thái hiện tại');
    if(typeof reason!=='string'||!reason.trim()||reason.length>2000)fail('reason','Điền lý do cập nhật lịch hẹn');
    if(['confirmed','completed'].includes(String(next.status))){
      if(!next.confirmed_starts_at||!next.confirmed_meeting_label)fail('confirmed_starts_at','Điền giờ xác nhận và điểm hẹn');
      const paid=(await c.query("SELECT 1 FROM xland.payment_intents i JOIN xland.payment_receipts r ON r.intent_id=i.id WHERE i.booking_id=$1 AND i.status='succeeded' AND r.verification_state='verified' AND r.received_amount_vnd=i.amount_vnd AND r.currency=i.currency AND r.mode=i.mode",[b.id])).rowCount;
      if(!paid)conflict('Lịch chưa có tiền cọc được xác minh. Không thể xác nhận hoặc hoàn tất.');
    }
    await c.query("UPDATE xland.slot_reservations SET state=$2 WHERE booking_id=$1",[b.id,['cancelled','rejected','expired','no_show','completed'].includes(String(next.status))?'released':'confirmed']);
    await c.query("INSERT INTO xland.booking_status_history(id,booking_id,from_status,to_status,actor_id,source,public_note) VALUES($1,$2,$3,$4,$5,'admin',$6)",[randomUUID(),b.id,b.status,next.status,identity.userId,reason.trim()]);
  }
  async audit(c:PoolClient,identity:Identity,action:string,entity:string,id:string|null,fields:string[]){
    await c.query('INSERT INTO xland.admin_audit_log(id,actor_id,action,entity,record_id,changed_fields) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),identity.userId,action,entity,id,JSON.stringify(fields)]);
  }
}
