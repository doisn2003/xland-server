import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {Database} from '../repositories/database.js';
import type {Identity} from '../services/auth.js';
import {DomainError,missing} from '../domain/errors.js';
import {automatic,entities,enums,references,type Entity} from './catalog.js';
import {validateStorageReferences} from './uploads.js';
import {hasPermission} from './permissions.js';

type Row=Record<string,unknown>;
function instant(value:unknown){return value instanceof Date?value.getTime():Date.parse(String(value));}
export interface Field {name:string;type:string;required:boolean;readonly:boolean;defaultValue:unknown;options?:string[]|undefined;reference?:string|undefined;precision:number|null;scale:number|null}
interface ColumnMetadata {table_name:string;column_name:string;data_type:string;is_nullable:string;column_default:string|null;is_generated:string;numeric_precision:number|null;numeric_scale:number|null}
function readColumns(fields:Field[]){return fields.map(f=>{const name='"'+f.name.replaceAll('"','""')+'"';return f.type==='date'?`${name}::text AS ${name}`:name;}).join(',');}
function fail(field:string,message='Kiểm tra thông tin đầu vào'):never {throw new DomainError(400,'INVALID_INPUT',message,[{field,code:'INVALID_VALUE'}]);}
function conflict(message:string):never {throw new DomainError(409,'CONFLICT',message);}
const content=z.string().max(10000);
const https=z.url().refine(v=>new URL(v).protocol==='https:');
const namedDetail=z.object({title:content,description:content}).strict();
const jsonLists:Record<string,z.ZodType>={
  highlights:z.array(namedDetail),benefits:z.array(namedDetail),tags:z.array(content),activities:z.array(content),
  agenda:z.array(z.object({startsAt:z.iso.datetime({offset:true}),title:content,description:content.nullable().optional()}).strict()),
  speakers:z.array(z.object({name:content,role:content,avatarUrl:https.nullable(),description:content.nullable().optional()}).strict()),
  media:z.array(z.object({id:z.string().min(1),kind:z.enum(['image','video']),url:https.nullable(),thumbnailUrl:https.nullable(),durationSeconds:z.number().int().nonnegative().nullable(),altText:content,isIllustrative:z.boolean()}).strict()),
};
export class AdminService {
  private columnCache: Map<string, ColumnMetadata[]> | null = null;
  private columnCachePromise: Promise<Map<string, ColumnMetadata[]>> | null = null;
  constructor(readonly db:Database){}
  entity(key:string):Entity {if(!Object.hasOwn(entities,key))missing();return entities[key]!;}
  async transaction<T>(identity:Identity,work:(c:PoolClient)=>Promise<T>){
    try{return await this.db.transaction('xland_admin',identity.userId,async c=>{
      return work(c);
    });}catch(error){
      const e=error as {code?:string;column?:string;message?:string};
      if(e.code==='23514'&&['parent_property_id','has_subplots','area_m2'].includes(e.column??''))fail(e.column!,e.message);
      if(e.code==='23505')conflict('Mã hoặc thứ tự đã tồn tại. Vui lòng chọn giá trị khác.');
      if(e.code==='23503')fail(e.column??'reference','Liên kết không hợp lệ hoặc đang được sử dụng.');
      if(['23514','23502','22P02','22003','22007','22008'].includes(e.code??''))fail(e.column??'record','Dữ liệu không thỏa mãn ràng buộc của hồ sơ. Kiểm tra số liệu, ngày giờ và các trường liên quan.');
      throw error;
    }
  }
  async loadColumns(c?:PoolClient):Promise<Map<string,ColumnMetadata[]>>{
    if(this.columnCache)return this.columnCache;
    if(this.columnCachePromise)return this.columnCachePromise;
    this.columnCachePromise=(async()=>{
      const fetchRows=async(client:PoolClient)=>(await client.query<ColumnMetadata>(`SELECT table_name,column_name,data_type,is_nullable,column_default,is_generated,numeric_precision,numeric_scale
        FROM information_schema.columns WHERE table_schema='xland' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position`,[Object.values(entities).map(e=>e.table)])).rows;
      let rows:ColumnMetadata[];
      if(c){
        rows=await fetchRows(c);
      }else{
        const client=await this.db.pool.connect();
        try{rows=await fetchRows(client);}finally{client.release();}
      }
      const map=new Map<string,ColumnMetadata[]>();
      for(const row of rows){
        let list=map.get(row.table_name);
        if(!list){list=[];map.set(row.table_name,list);}
        list.push(row);
      }
      this.columnCache=map;
      this.columnCachePromise=null;
      return map;
    })();
    return this.columnCachePromise;
  }
  async fields(_c:PoolClient|undefined,key:string):Promise<Field[]>{
    const e=this.entity(key);
    const map=await this.loadColumns(_c);
    return this.describeFields(key,map.get(e.table)??[]);
  }
  private describeFields(key:string,rows:ColumnMetadata[]):Field[]{
    const e=this.entity(key);
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
  async schema(identity?:Identity){
    const map=await this.loadColumns();
    const result:Record<string,unknown>={};
    for(const [key,e] of Object.entries(entities)){
      if(identity&&!hasPermission(identity.roles,key,'read'))continue;
      result[key]={...e,fields:this.describeFields(key,map.get(e.table)??[])};
    }
    return result;
  }
  async overview(identity:Identity){return this.transaction(identity,async c=>({
    counts:(await c.query(`SELECT (SELECT count(*)::int FROM xland.properties) properties,
      (SELECT count(*)::int FROM xland.videos WHERE deleted_at IS NULL) videos,
      (SELECT count(*)::int FROM xland.consultants) consultants,
      (SELECT count(*)::int FROM xland.site_visit_bookings WHERE status NOT IN ('completed','cancelled','expired','rejected','no_show')) bookings,
      (SELECT count(*)::int FROM xland.support_requests WHERE status IN ('received','pending')) support`)).rows[0],
    recent:hasPermission(identity.roles,'audit','read')?(await c.query('SELECT * FROM xland.admin_audit_log ORDER BY created_at DESC,id DESC LIMIT 8')).rows:[],
  }));}
  async list(identity:Identity,key:string,q:{q?:string|undefined;page:number;limit:number;filter?:string|undefined;value?:string|undefined}){
    if(!hasPermission(identity.roles,key,'read'))throw new DomainError(403,'FORBIDDEN','Tài khoản không có quyền truy cập danh mục này');
    const e=this.entity(key);
    return this.transaction(identity,async c=>{
      const args:unknown[]=[];const where:string[]=[];
      if(q.q){args.push('%'+q.q.replace(/[\\%_]/g,'\\$&')+'%');where.push('('+e.search.map(s=>`"${s}" ILIKE $1`).join(' OR ')+')');}
      if(q.filter){if(!e.filter?.includes(q.filter)||!q.value)fail('filter');args.push(q.value);where.push(`"${q.filter}"::text=$${args.length}`);}
      const clause=where.length?'WHERE '+where.join(' AND '):'';
      const fields=await this.fields(c,key);const order=fields.some(f=>f.name==='created_at')?'created_at DESC,id DESC':'id DESC';
      const rows=(await c.query(`SELECT ${readColumns(fields)},count(*) OVER() AS _full_count,xmin::text AS _version FROM xland.${e.table} ${clause} ORDER BY ${order} LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,q.limit,(q.page-1)*q.limit])).rows;
      let total=rows.length?Number(rows[0]._full_count):0;
      if(!rows.length&&q.page>1){
        total=Number((await c.query(`SELECT count(*) n FROM xland.${e.table} ${clause}`,args)).rows[0].n);
      }
      for(const row of rows)delete row._full_count;
      const fkLookups:{col:string;target:Entity;label:string;ids:unknown[]}[]=[];
      for(const col of e.columns){
        const ref=references[col];if(!ref)continue;
        const target=this.entity(ref),label=target.search[0]??'id';
        const ids=rows.map(r=>r[col]).filter(Boolean);if(!ids.length)continue;
        fkLookups.push({col,target,label,ids});
      }
      if(fkLookups.length===1){
        const fk=fkLookups[0]!;
        const names=(await c.query(`SELECT id,"${fk.label}"::text label FROM xland.${fk.target.table} WHERE id=ANY($1::uuid[])`,[fk.ids])).rows;
        for(const row of rows)row._labels={...row._labels,[fk.col]:names.find(n=>n.id===row[fk.col])?.label??row[fk.col]};
      }else if(fkLookups.length>1){
        const unionQuery=fkLookups.map((fk,idx)=>`SELECT '${fk.col}' AS _col,id,"${fk.label}"::text label FROM xland.${fk.target.table} WHERE id=ANY($${idx+1}::uuid[])`).join(' UNION ALL ');
        const names=(await c.query(unionQuery,fkLookups.map(fk=>fk.ids))).rows;
        for(const fk of fkLookups){
          const colNames=names.filter(n=>n._col===fk.col);
          for(const row of rows)row._labels={...row._labels,[fk.col]:colNames.find(n=>n.id===row[fk.col])?.label??row[fk.col]};
        }
      }
      return {items:rows,total,page:q.page,limit:q.limit};
    });
  }
  async get(identity:Identity,key:string,id:string){
    if(!hasPermission(identity.roles,key,'read'))throw new DomainError(403,'FORBIDDEN','Tài khoản không có quyền truy cập hồ sơ này');
    return this.transaction(identity,async c=>{
    const e=this.entity(key),fields=await this.fields(c,key);const row=(await c.query(`SELECT ${readColumns(fields)},xmin::text AS _version FROM xland.${e.table} WHERE id=$1`,[id])).rows[0];if(!row)missing();
    if(key==='videos')row.media=(await c.query('SELECT *,xmin::text AS _version FROM xland.property_media WHERE id=$1',[row.media_id])).rows[0];
    if(key==='consultants')row.contact=(await c.query('SELECT phone,email_contact FROM xland.user_contacts WHERE user_id=$1',[id])).rows[0];
    if(key==='users')row.roles=(await c.query('SELECT role, granted_at FROM xland.user_roles WHERE user_id=$1 ORDER BY role',[id])).rows;
    if(key==='bookings'){
      row.history=(await c.query('SELECT * FROM xland.booking_status_history WHERE booking_id=$1 ORDER BY occurred_at,id',[id])).rows;
      row.payments=(await c.query('SELECT id,status,mode,amount_vnd FROM xland.payment_intents WHERE booking_id=$1',[id])).rows;
    }
    return row;
  });}
  async lookup(identity:Identity,key:string,q:string,id?:string){
    if(!hasPermission(identity.roles,key,'read'))throw new DomainError(403,'FORBIDDEN','Tài khoản không có quyền truy cập danh mục này');
    return this.transaction(identity,async c=>{
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
        if((f.type==='numeric'||f.type==='bigint')&&typeof value!=='string')fail(name,'Gửi số thập phân hoặc số lớn dưới dạng chuỗi để giữ nguyên độ chính xác');
        if(typeof value!=='string'&&typeof value!=='number')fail(name);
        const raw=String(value);if(!/^-?\d+(\.\d+)?$/.test(raw)||!Number.isFinite(Number(raw)))fail(name);
        const [whole,fraction='']=raw.replace('-','').split('.');
        if(f.type!=='numeric'&&fraction)fail(name);
        if(f.type==='numeric'&&f.precision!==null&&((whole?.replace(/^0+/,'').length??0)>f.precision-(f.scale??0)||fraction.length>(f.scale??0)))fail(name,'Số vượt quá độ chính xác cho phép');
        if(f.type==='integer'&&!Number.isSafeInteger(Number(raw)))fail(name);
        if(name==='sort_order'&&Number(raw)<0)fail(name,'Thứ tự phải lớn hơn hoặc bằng 0');
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
    const action=create?'create':'update';
    if(!hasPermission(identity.roles,key,action))throw new DomainError(403,'FORBIDDEN','Tài khoản không có quyền chỉnh sửa mục này');
    return this.transaction(identity,async c=>{
      const recordId=id??randomUUID();const fields=await this.fields(c,key);
      if(key==='properties')await c.query('SELECT pg_advisory_xact_lock(193726,19)');
      const {_version,contact,reason,...payload}=input;
      const media=key==='videos'?payload.media:undefined;
      if(key==='videos')delete payload.media;
      let prior:Row|undefined;
      if(!create){
        prior=(await c.query(`SELECT *,xmin::text AS _version FROM xland.${e.table} WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!prior)missing();
        if(_version&&_version!==prior._version)conflict('Hồ sơ đã thay đổi. Tải lại trước khi lưu.');
      }
      if(key==='videos'&&media){
        if(typeof media!=='object'||Array.isArray(media))fail('media');
        const mediaId=prior?String(prior.media_id):randomUUID();
        if(prior&&payload.property_id!==undefined&&payload.property_id!==prior.property_id)fail('property_id','Không thể chuyển video đã đăng sang lô khác');
        const {_version:mediaVersion,...mediaPayload}=media as Row;
        const priorMedia=prior?(await c.query('SELECT *,xmin::text AS _version FROM xland.property_media WHERE id=$1 FOR UPDATE',[mediaId])).rows[0]:undefined;
        if(prior&&(!priorMedia||!mediaVersion||mediaVersion!==priorMedia._version))conflict('Media của video đã thay đổi. Tải lại trước khi lưu.');
        const values=this.validate(await this.fields(c,'media'),{...mediaPayload,property_id:payload.property_id??prior?.property_id,kind:'video',usage:'feed'},!prior);
        const mergedMedia={...priorMedia,...values};
        if(!mergedMedia.public_url||!mergedMedia.storage_key)fail('media.public_url','Vui lòng tải video lên Supabase Storage');
        if(prior&&(await c.query('SELECT id FROM xland.videos WHERE media_id=$1 AND id<>$2',[mediaId,id])).rowCount)conflict('Media đang được dùng chung. Hãy tạo video mới để thay nội dung.');
        await validateStorageReferences(c,mergedMedia,priorMedia);
        await this.write(c,'property_media',mediaId,values,!prior);payload.media_id=mediaId;
      }else if(key!=='videos'&&media!==undefined)fail('media');
      if(contact!==undefined&&key!=='consultants')fail('contact');
      if(reason!==undefined&&key!=='bookings')fail('reason');
      const data=this.validate(fields,payload,create);
      const merged={...prior,...data};
      await validateStorageReferences(c,merged,prior);
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
        const m=(await c.query("SELECT id FROM xland.property_media WHERE id=$1 AND property_id=$2 AND kind='video' AND usage='feed' AND nullif(trim(public_url),'') IS NOT NULL AND nullif(trim(storage_key),'') IS NOT NULL FOR UPDATE",[merged.media_id,merged.property_id])).rows[0];
        if(!m)fail('media_id','Video phải liên kết media video/feed của chính lô đất');
      }
      if(key==='media'&&prior){
        const used=(await c.query('SELECT id FROM xland.videos WHERE media_id=$1',[id])).rowCount;
        if(used&&(merged.kind!=='video'||merged.usage!=='feed'||merged.property_id!==prior.property_id))conflict('Media đang gắn với video feed; không thể đổi loại hoặc lô đất.');
        if(used&&(!String(merged.public_url??'').trim()||!String(merged.storage_key??'').trim()))conflict('Media đang gắn với video feed; không thể xóa nguồn phát.');
      }
      if(key==='documents'&&merged.access_level!=='public_redacted'&&merged.storage_key&&!String(merged.storage_key).startsWith('xland-admin-documents/'))fail('storage_key','Tài liệu hạn chế truy cập phải được tải vào kho riêng tư bằng form này');
      if(key==='slots'&&prior){
        const used=(await c.query("SELECT count(*)::int n FROM xland.slot_reservations WHERE slot_id=$1 AND state<>'released'",[id])).rows[0].n;
        if(used&&(String(merged.starts_at)!==String(prior.starts_at)||String(merged.ends_at)!==String(prior.ends_at)||merged.property_id!==prior.property_id)){
          // Compare instants: JSON dates differ from pg Date objects in representation.
          if(instant(merged.starts_at)!==instant(prior.starts_at)||instant(merged.ends_at)!==instant(prior.ends_at)||merged.property_id!==prior.property_id)conflict('Khung giờ đã có lịch hẹn; chỉ có thể đóng nhận lịch mới.');
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
    const timeChanged=(b.confirmed_starts_at==null?null:instant(b.confirmed_starts_at))!==(next.confirmed_starts_at==null?null:instant(next.confirmed_starts_at));
    const statusChanged=b.status!==next.status;
    // Cross-slot rescheduling is outside this workspace. Preserve the reservation
    // and requested slot instead of silently changing only the displayed time.
    if(timeChanged&&next.confirmed_starts_at!=null&&instant(next.confirmed_starts_at)!==instant(b.requested_starts_at))fail('confirmed_starts_at','Giờ xác nhận phải khớp khung giờ đã đặt; chưa hỗ trợ đổi khung giờ');
    if(!statusChanged)return;
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
  async aggregate(identity:Identity,propertyId:string){
    return this.transaction(identity,async c=>{
      const query=`SELECT 
        p.*,
        p.xmin::text AS _version,
        c.name AS consultant_name,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', m.id,
              'property_id', m.property_id,
              'kind', m.kind,
              'usage', m.usage,
              'storage_key', m.storage_key,
              'public_url', m.public_url,
              'thumbnail_url', m.thumbnail_url,
              'alt_text', m.alt_text,
              'duration_seconds', m.duration_seconds,
              'sort_order', m.sort_order,
              'is_illustrative', m.is_illustrative,
              '_version', m.xmin::text
            ) ORDER BY m.sort_order, m.id
          ) FROM xland.property_media m WHERE m.property_id = p.id
        ), '[]'::json) AS media,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', l.id,
              'property_id', l.property_id,
              'title', l.title,
              'subtitle', l.subtitle,
              'checked_date', l.checked_date::text,
              'status', l.status,
              'sort_order', l.sort_order,
              '_version', l.xmin::text
            ) ORDER BY l.sort_order, l.id
          ) FROM xland.property_legal_items l WHERE l.property_id = p.id
        ), '[]'::json) AS legal_items,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', d.id,
              'property_id', d.property_id,
              'title', d.title,
              'file_type', d.file_type,
              'mime_type', d.mime_type,
              'size_bytes', d.size_bytes::text,
              'uploaded_date', d.uploaded_date::text,
              'storage_key', d.storage_key,
              'access_level', d.access_level,
              'public_preview_url', d.public_preview_url,
              'is_illustrative', d.is_illustrative,
              '_version', d.xmin::text
            ) ORDER BY d.uploaded_date DESC, d.id
          ) FROM xland.property_documents d WHERE d.property_id = p.id
        ), '[]'::json) AS documents,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', a.id,
              'property_id', a.property_id,
              'category', a.category,
              'name', a.name,
              'distance_text', a.distance_text,
              'icon_type', a.icon_type,
              'approximate_lat', a.approximate_lat,
              'approximate_lng', a.approximate_lng,
              'sort_order', a.sort_order,
              '_version', a.xmin::text
            ) ORDER BY a.sort_order, a.id
          ) FROM xland.property_nearby_amenities a WHERE a.property_id = p.id
        ), '[]'::json) AS amenities,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', s.id,
              'property_id', s.property_id,
              'label', s.label,
              'starts_at', s.starts_at,
              'ends_at', s.ends_at,
              'max_attendees', s.max_attendees,
              'max_bookings', s.max_bookings,
              'status', s.status,
              'approximate_meeting_lat', s.approximate_meeting_lat,
              'approximate_meeting_lng', s.approximate_meeting_lng,
              'radius_m', s.radius_m,
              'is_illustrative', s.is_illustrative,
              '_version', s.xmin::text
            ) ORDER BY s.starts_at DESC
          ) FROM xland.site_visit_slots s WHERE s.property_id = p.id
        ), '[]'::json) AS slots,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', b.id,
              'property_id', b.property_id,
              'customer_name', b.customer_name,
              'customer_phone', b.customer_phone,
              'requested_starts_at', b.requested_starts_at,
              'confirmed_starts_at', b.confirmed_starts_at,
              'attendee_count', b.attendee_count,
              'status', b.status,
              'confirmed_meeting_label', b.confirmed_meeting_label,
              '_version', b._version
            ) ORDER BY b.requested_starts_at DESC
          ) FROM (
            SELECT *, xmin::text AS _version FROM xland.site_visit_bookings WHERE property_id = p.id ORDER BY requested_starts_at DESC LIMIT 20
          ) b
        ), '[]'::json) AS bookings
      FROM xland.properties p
      LEFT JOIN xland.consultants c ON c.id = p.consultant_id
      WHERE p.id = $1`;
      const row=(await c.query(query,[propertyId])).rows[0];
      if(!row)missing();
      row.subdivision=(await c.query(`SELECT count(*)::int total,COALESCE(sum(area_m2),0)::text allocated_area_m2,
        ($2::numeric-COALESCE(sum(area_m2),0))::text remaining_area_m2,
        count(*) FILTER(WHERE status='listed')::int listed,count(*) FILTER(WHERE status='sold')::int sold,
        count(*) FILTER(WHERE approval_status='pending')::int pending
        FROM xland.properties WHERE parent_property_id=$1`,[propertyId,row.area_m2])).rows[0];
      row.parent=row.parent_property_id?(await c.query('SELECT id,code,title FROM xland.properties WHERE id=$1',[row.parent_property_id])).rows[0]:null;
      return row;
    });
  }
  async createChild(identity:Identity,parentId:string,input:Row){
    if(!hasPermission(identity.roles,'properties','create'))throw new DomainError(403,'FORBIDDEN','Không có quyền tạo lô con');
    return this.transaction(identity,async c=>{
      await c.query('SELECT pg_advisory_xact_lock(193726,19)');
      const parent=(await c.query('SELECT *,xmin::text AS _version FROM xland.properties WHERE id=$1 FOR UPDATE',[parentId])).rows[0];
      if(!parent)missing();
      if(!parent.has_subplots)fail('has_subplots','Bật Nhiều lô đất con trước khi tạo lô.');
      const {_version,...payload}=input;
      if(!_version||_version!==parent._version)conflict('Hồ sơ cha đã thay đổi. Tải lại studio trước khi tạo lô.');
      for(const field of ['code','title','area_m2','price_total'])if(payload[field]===undefined)fail(field,'Điền mã, tên, diện tích và giá riêng của lô con.');
      for(const field of ['parent_property_id','approval_status','has_subplots','status'])if(field in payload)fail(field,'Trạng thái và quan hệ của lô mới do hệ thống thiết lập.');
      const fields=await this.fields(c,'properties');
      const inherited=Object.fromEntries(fields.filter(f=>!f.readonly).map(f=>[f.name,parent[f.name]]));
      const values=this.validate(fields,{...inherited,...payload,parent_property_id:parentId,has_subplots:false,is_corner:payload.is_corner??false,approval_status:'pending',status:'paused'},true);
      // Inherit location unchanged; later edits use the ordinary validated endpoint.
      for(const field of ['province','province_code','district','district_code','catalog_version','lat','lng','approximate_lat','approximate_lng','approximate_radius_m'])
        if(field in payload)fail(field,'Chỉnh vị trí trong hồ sơ lô con sau khi tạo.');
      const id=randomUUID();
      await this.write(c,'properties',id,values,true);
      for(const [table,overrides] of [
        ['property_media',{}],['property_legal_items',{status:'pending',checked_date:null}],
        ['property_documents',{}],['property_nearby_amenities',{}],
      ] as const){
        const rows=(await c.query(`SELECT * FROM xland.${table} WHERE property_id=$1${table==='property_media'?" AND usage IN ('gallery','area')":''}`,[parentId])).rows;
        for(const row of rows){
          const {id:oldId,created_at,updated_at,...copy}=row;void oldId;void created_at;void updated_at;
          await this.write(c,table,randomUUID(),{...copy,...overrides,property_id:id},true);
        }
      }
      // Invalidate concurrent studio creates and stale parent forms as one atomic operation.
      await c.query('UPDATE xland.properties SET updated_at=now() WHERE id=$1',[parentId]);
      await this.audit(c,identity,'create-child','properties',id,['parent_property_id',...Object.keys(payload)]);
      return (await c.query(`SELECT ${readColumns(fields)},xmin::text AS _version FROM xland.properties WHERE id=$1`,[id])).rows[0];
    });
  }
  async reorderMedia(identity:Identity,propertyId:string,items:{id:string;sort_order:number}[]){
    return this.transaction(identity,async c=>{
      if(!items.length)return {updated:0};
      for(let i=0;i<items.length;i++){
        await c.query('UPDATE xland.property_media SET sort_order=$1 WHERE id=$2 AND property_id=$3',[-(1000+i),items[i]!.id,propertyId]);
      }
      for(const item of items){
        await c.query('UPDATE xland.property_media SET sort_order=$1 WHERE id=$2 AND property_id=$3',[item.sort_order,item.id,propertyId]);
      }
      await this.audit(c,identity,'reorder','property_media',propertyId,['sort_order']);
      return {updated:items.length};
    });
  }
  async delete(identity:Identity,key:string,id:string){
    if(!hasPermission(identity.roles,key,'delete'))throw new DomainError(403,'FORBIDDEN','Yêu cầu quyền Super Admin để thực hiện thao tác xóa');
    const deletableEntities=['media','legal','documents','amenities','properties','consultants','clubs','events','videos','slots','support'];
    if(!deletableEntities.includes(key))throw new DomainError(405,'NOT_ALLOWED','Không hỗ trợ xóa loại hồ sơ này');
    const e=this.entity(key);
    return this.transaction(identity,async c=>{
      const prior=(await c.query(`SELECT *,xmin::text AS _version FROM xland.${e.table} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
      if(!prior)missing();
      if(key==='media'){
        const used=(await c.query('SELECT id FROM xland.videos WHERE media_id=$1',[id])).rowCount;
        if(used)conflict('Media đang được gắn với video feed; không thể xóa.');
      }
      if(key==='properties'){
        const hasSubplots=(await c.query('SELECT 1 FROM xland.properties WHERE parent_property_id=$1',[id])).rowCount;
        if(hasSubplots)conflict('Lô đất đang có các lô con trực thuộc. Hãy xóa các lô con trước.');
        const activeBookings=(await c.query("SELECT 1 FROM xland.site_visit_bookings WHERE property_id=$1 AND status IN ('pending_confirmation','confirmed','awaiting_deposit')",[id])).rowCount;
        if(activeBookings)conflict('Lô đất đang có lịch hẹn xem thực địa chưa hoàn tất. Không thể xóa.');
        await c.query('DELETE FROM xland.saved_properties WHERE property_id=$1',[id]);
        await c.query('DELETE FROM xland.saved_finance_plans WHERE property_id=$1',[id]);
        await c.query('DELETE FROM xland.support_requests WHERE property_id=$1',[id]);
        await c.query('DELETE FROM xland.payment_status_history WHERE intent_id IN (SELECT id FROM xland.payment_intents WHERE booking_id IN (SELECT id FROM xland.site_visit_bookings WHERE property_id=$1))',[id]);
        await c.query('DELETE FROM xland.payment_provider_events WHERE receipt_id IN (SELECT id FROM xland.payment_receipts WHERE intent_id IN (SELECT id FROM xland.payment_intents WHERE booking_id IN (SELECT id FROM xland.site_visit_bookings WHERE property_id=$1)))',[id]);
        await c.query('DELETE FROM xland.payment_receipts WHERE intent_id IN (SELECT id FROM xland.payment_intents WHERE booking_id IN (SELECT id FROM xland.site_visit_bookings WHERE property_id=$1))',[id]);
        await c.query('DELETE FROM xland.payment_intents WHERE booking_id IN (SELECT id FROM xland.site_visit_bookings WHERE property_id=$1)',[id]);
        await c.query('DELETE FROM xland.booking_status_history WHERE booking_id IN (SELECT id FROM xland.site_visit_bookings WHERE property_id=$1)',[id]);
        await c.query('DELETE FROM xland.slot_reservations WHERE booking_id IN (SELECT id FROM xland.site_visit_bookings WHERE property_id=$1) OR slot_id IN (SELECT id FROM xland.site_visit_slots WHERE property_id=$1)',[id]);
        await c.query('DELETE FROM xland.site_visit_bookings WHERE property_id=$1',[id]);
        await c.query('DELETE FROM xland.site_visit_slots WHERE property_id=$1',[id]);
        await c.query('DELETE FROM xland.saved_videos WHERE video_id IN (SELECT id FROM xland.videos WHERE property_id=$1)',[id]);
        await c.query('DELETE FROM xland.video_comments WHERE video_id IN (SELECT id FROM xland.videos WHERE property_id=$1)',[id]);
        await c.query('DELETE FROM xland.video_likes WHERE video_id IN (SELECT id FROM xland.videos WHERE property_id=$1)',[id]);
        await c.query('DELETE FROM xland.videos WHERE property_id=$1',[id]);
        await c.query('DELETE FROM xland.document_access_grants WHERE document_id IN (SELECT id FROM xland.property_documents WHERE property_id=$1)',[id]);
        await c.query('DELETE FROM xland.property_documents WHERE property_id=$1',[id]);
        await c.query('DELETE FROM xland.property_media WHERE property_id=$1',[id]);
        await c.query('DELETE FROM xland.property_legal_items WHERE property_id=$1',[id]);
        await c.query('DELETE FROM xland.property_nearby_amenities WHERE property_id=$1',[id]);
      }
      if(key==='consultants'){
        const assigned=(await c.query('SELECT 1 FROM xland.properties WHERE consultant_id=$1',[id])).rowCount;
        if(assigned)conflict('Tư vấn viên đang phụ trách lô đất. Vui lòng chuyển giao người phụ trách trước khi xóa.');
        await c.query('UPDATE xland.site_visit_slots SET consultant_id=NULL WHERE consultant_id=$1',[id]);
        await c.query('UPDATE xland.site_visit_bookings SET consultant_id=NULL WHERE consultant_id=$1',[id]);
        await c.query('DELETE FROM xland.support_requests WHERE consultant_id=$1 AND property_id IS NULL',[id]);
        await c.query('UPDATE xland.support_requests SET consultant_id=NULL WHERE consultant_id=$1',[id]);
        await c.query('DELETE FROM xland.consultant_reviews WHERE consultant_id=$1',[id]);
        await c.query("DELETE FROM xland.user_roles WHERE user_id=$1 AND role='consultant'",[id]);
      }
      if(key==='events'){
        const hasConfirmed=(await c.query("SELECT 1 FROM xland.event_registrations WHERE event_id=$1 AND status='registered'",[id])).rowCount;
        if(hasConfirmed)conflict('Sự kiện đã có khách đăng ký thành công. Vui lòng xử lý đăng ký trước khi xóa.');
        await c.query('DELETE FROM xland.saved_events WHERE event_id=$1',[id]);
        await c.query('DELETE FROM xland.event_registrations WHERE event_id=$1',[id]);
      }
      if(key==='slots'){
        const used=(await c.query("SELECT 1 FROM xland.slot_reservations WHERE slot_id=$1 AND state<>'released'",[id])).rowCount;
        if(used)conflict('Khung giờ đang có khách giữ chỗ. Không thể xóa.');
        await c.query('DELETE FROM xland.slot_reservations WHERE slot_id=$1',[id]);
      }
      if(key==='videos'){
        await c.query('DELETE FROM xland.saved_videos WHERE video_id=$1',[id]);
        await c.query('DELETE FROM xland.video_comments WHERE video_id=$1',[id]);
        await c.query('DELETE FROM xland.video_likes WHERE video_id=$1',[id]);
      }
      await c.query(`DELETE FROM xland.${e.table} WHERE id=$1`,[id]);
      await this.audit(c,identity,'delete',key,id,Object.keys(prior));
      return {id,deleted:true};
    });
  }
  async updateUserRoles(identity:Identity,targetUserId:string,newRoles:('admin'|'moderator')[],access?:{clearCache:()=>void}){
    if(!identity.roles?.includes('admin')){
      throw new DomainError(403,'FORBIDDEN','Chỉ Super Admin mới có quyền phân quyền người dùng');
    }
    if(identity.userId===targetUserId&&!newRoles.includes('admin')){
      throw new DomainError(400,'INVALID_OPERATION','Không thể tự tước quyền Super Admin của chính mình');
    }
    return this.transaction(identity,async c=>{
      const user=(await c.query('SELECT id FROM xland.user_profiles WHERE id=$1',[targetUserId])).rows[0];
      if(!user)missing();
      await c.query("DELETE FROM xland.user_roles WHERE user_id=$1 AND role IN ('admin','moderator')",[targetUserId]);
      for(const r of newRoles){
        await c.query("INSERT INTO xland.user_roles(user_id,role,granted_by) VALUES($1,$2,$3)",[targetUserId,r,identity.userId]);
      }
      await this.audit(c,identity,'update-roles','users',targetUserId,newRoles);
      if(access)access.clearCache();
      const updatedRoles=(await c.query("SELECT role FROM xland.user_roles WHERE user_id=$1 AND role IN ('admin','moderator') ORDER BY role",[targetUserId])).rows.map(r=>r.role);
      return {userId:targetUserId,roles:updatedRoles};
    });
  }
  async moderationVideos(identity:Identity,filterStatus?:string){
    return this.transaction(identity,async c=>{
      const params:unknown[]=[];
      let whereClause="WHERE v.deleted_at IS NULL";
      if(filterStatus&&['pending','approved','rejected'].includes(filterStatus)){
        params.push(filterStatus);
        whereClause+=` AND v.approval_status = $${params.length}`;
      }
      const query=`
        SELECT 
          v.id,
          v.property_id,
          v.author_id,
          v.media_id,
          v.caption,
          v.published_at,
          v.approval_status,
          v.view_count::text AS view_count,
          v.is_illustrative,
          v.xmin::text AS _version,
          json_build_object(
            'id', u.id,
            'display_name', u.display_name,
            'avatar_url', u.avatar_url,
            'public_role', u.public_role
          ) AS author,
          json_build_object(
            'id', p.id,
            'code', p.code,
            'title', p.title,
            'province', p.province
          ) AS property,
          json_build_object(
            'id', m.id,
            'public_url', m.public_url,
            'thumbnail_url', m.thumbnail_url,
            'duration_seconds', m.duration_seconds,
            'alt_text', m.alt_text
          ) AS media,
          COALESCE((SELECT count(*)::int FROM xland.video_likes l WHERE l.video_id = v.id), 0) AS likes_count,
          COALESCE((SELECT count(*)::int FROM xland.video_comments comm WHERE comm.video_id = v.id AND comm.deleted_at IS NULL), 0) AS comments_count
        FROM xland.videos v
        JOIN xland.user_profiles u ON u.id = v.author_id
        JOIN xland.properties p ON p.id = v.property_id
        JOIN xland.property_media m ON m.id = v.media_id
        ${whereClause}
        ORDER BY (CASE WHEN v.approval_status = 'pending' THEN 0 ELSE 1 END), v.published_at DESC
        LIMIT 100
      `;
      return (await c.query(query,params)).rows;
    });
  }
  async reviewVideo(identity:Identity,videoId:string,status:'approved'|'rejected',reason?:string){
    return this.transaction(identity,async c=>{
      const prior=(await c.query(`SELECT *, xmin::text AS _version FROM xland.videos WHERE id = $1 FOR UPDATE`,[videoId])).rows[0];
      if(!prior)missing();
      await c.query(`UPDATE xland.videos SET approval_status = $1 WHERE id = $2`,[status,videoId]);
      await this.audit(c,identity,'review','videos',videoId,['approval_status',...(reason?['rejection_reason']: [])]);
      return (await c.query(`SELECT *, xmin::text AS _version FROM xland.videos WHERE id = $1`,[videoId])).rows[0];
    });
  }
  async eventAggregate(identity:Identity,eventId:string){
    return this.transaction(identity,async c=>{
      const query=`
        SELECT 
          e.*,
          e.xmin::text AS _version,
          COALESCE((
            SELECT json_agg(
              json_build_object(
                'id', r.id,
                'event_id', r.event_id,
                'user_id', r.user_id,
                'attendee_count', r.attendee_count,
                'contact_name', r.contact_name,
                'contact_phone', r.contact_phone,
                'status', r.status,
                'ticket_price_snapshot', r.ticket_price_snapshot::text,
                'payment_mode', r.payment_mode,
                'created_at', r.created_at::text,
                '_version', r._version
              ) ORDER BY r.created_at DESC
            ) FROM (
              SELECT *, xmin::text AS _version FROM xland.event_registrations WHERE event_id = e.id ORDER BY created_at DESC
            ) r
          ), '[]'::json) AS registrations,
          COALESCE((SELECT sum(r2.attendee_count)::int FROM xland.event_registrations r2 WHERE r2.event_id = e.id AND r2.status = 'registered'), 0) AS registered_attendees,
          COALESCE((SELECT sum(r3.attendee_count)::int FROM xland.event_registrations r3 WHERE r3.event_id = e.id AND r3.status = 'pending'), 0) AS pending_attendees
        FROM xland.events e
        WHERE e.id = $1
      `;
      const row=(await c.query(query,[eventId])).rows[0];
      if(!row)missing();
      return row;
    });
  }
  async exportEventRegistrationsCsv(identity:Identity,eventId:string):Promise<{filename:string;csv:string}>{
    return this.transaction(identity,async c=>{
      const event=(await c.query(`SELECT id, title, starts_at FROM xland.events WHERE id = $1`,[eventId])).rows[0];
      if(!event)missing();
      const rows=(await c.query(`SELECT id, contact_name, contact_phone, attendee_count, status, created_at, ticket_price_snapshot, payment_mode FROM xland.event_registrations WHERE event_id = $1 ORDER BY created_at DESC`,[eventId])).rows;

      const sanitize=(val:unknown)=>{
        const str=String(val??'').replaceAll('"','""');
        return /[",\n\r]/.test(str)?`"${str}"`:str;
      };

      const statusMap:Record<string,string>={
        registered:'Đã xác nhận',
        pending:'Chờ duyệt',
        cancelled:'Đã hủy',
      };

      const header=['Mã đăng ký','Họ tên khách','Số điện thoại','Số vé','Trạng thái','Thời gian đăng ký','Giá vé (đ)','Thanh toán'];
      const lines=[header.map(sanitize).join(',')];

      for(const r of rows){
        lines.push([
          sanitize(r.id),
          sanitize(r.contact_name),
          sanitize(r.contact_phone),
          sanitize(r.attendee_count),
          sanitize(statusMap[String(r.status)]??r.status),
          sanitize(new Date(r.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})),
          sanitize(r.ticket_price_snapshot),
          sanitize(r.payment_mode),
        ].join(','));
      }

      const csv='\uFEFF'+lines.join('\r\n');
      const asciiTitle=String(event.title||'event').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,40);
      const filename=`registrations-${asciiTitle}-${eventId.slice(0,8)}.csv`;
      await this.audit(c,identity,'export_csv','event_registrations',eventId,['csv_download']);
      return {filename,csv};
    });
  }
}
