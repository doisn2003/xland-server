import type { PoolClient } from 'pg';
import type { Database } from './database.js';
import type { CursorCodec } from '../services/cursor.js';
import type { PropertyQuery } from '../schemas/http.js';
import { DomainError, invalid, missing, unauthenticated } from '../domain/errors.js';

export type Wire=Record<string,unknown>;
export const propertyColumns=['id','code','title','province','province_code','district','district_code','region','category','price_total','price_per_m2','area_m2','frontage_m','depth_m','road_width_m','direction','land_type','status','status_badge','approval_status','consultant_id','highlights','is_illustrative','updated_at','approximate_lat','approximate_lng','approximate_radius_m'];
export class PropertyRepository {
  constructor(readonly db:Database,readonly cursor:CursorCodec) {}
  async map(c:PoolClient,p:Wire):Promise<Wire> {
    const media=await c.query(`SELECT id,kind,public_url,thumbnail_url,duration_seconds,alt_text,is_illustrative FROM xland.property_media WHERE property_id=$1 AND usage='gallery' ORDER BY sort_order`,[p.id]);
    const legal=await c.query(`SELECT count(*)::int total,count(*) FILTER(WHERE status='verified')::int verified FROM xland.property_legal_items WHERE property_id=$1`,[p.id]);
    const saved=await c.query('SELECT EXISTS(SELECT 1 FROM xland.saved_properties WHERE property_id=$1) active',[p.id]);
    return this.project(p,media.rows,legal.rows[0].total,legal.rows[0].verified,saved.rows[0].active);
  }
  private project(p:Wire,media:Wire[],total:number,verified:number,saved:boolean):Wire {
    return {id:p.id,code:p.code,title:p.title,provinceCode:p.province_code,provinceName:p.province,districtCode:p.district_code,districtName:p.district,
      region:p.region,category:p.category,priceTotal:p.price_total,pricePerM2:p.price_per_m2,areaM2:p.area_m2,frontageM:p.frontage_m,depthM:p.depth_m,roadWidthM:p.road_width_m,
      direction:p.direction,landType:p.land_type,status:p.status,approvalStatus:p.approval_status,sourceBadge:p.status_badge,consultantId:p.consultant_id,
      media:media.map(m=>({id:m.id,kind:m.kind,url:m.public_url,thumbnailUrl:m.thumbnail_url,durationSeconds:m.duration_seconds,altText:m.alt_text,isIllustrative:m.is_illustrative})),
      highlights:p.highlights,verifiedLegalCount:verified,totalLegalCount:total,isSaved:saved,updatedAt:(p.updated_at as Date).toISOString(),isIllustrative:p.is_illustrative};
  }
  async getMany(c:PoolClient,ids:string[]):Promise<Map<string,Wire>> {
    const unique=[...new Set(ids)];const result=new Map<string,Wire>();if(!unique.length)return result;
    // All queries share the caller's RLS identity and repeatable-read snapshot.
    // No process cache or secondary/privileged connection is involved.
    const properties=await c.query<Wire>(`SELECT ${propertyColumns.join(',')} FROM xland.properties WHERE id=ANY($1::uuid[])`,[unique]);
    const media=await c.query<Wire>("SELECT property_id,id,kind,public_url,thumbnail_url,duration_seconds,alt_text,is_illustrative FROM xland.property_media WHERE property_id=ANY($1::uuid[]) AND usage='gallery' ORDER BY property_id,sort_order",[unique]);
    const legal=await c.query("SELECT property_id,count(*)::int total,count(*) FILTER(WHERE status='verified')::int verified FROM xland.property_legal_items WHERE property_id=ANY($1::uuid[]) GROUP BY property_id",[unique]);
    const saved=await c.query('SELECT property_id FROM xland.saved_properties WHERE property_id=ANY($1::uuid[])',[unique]);
    const groups=new Map<string,Wire[]>();for(const m of media.rows){const id=String(m.property_id);const group=groups.get(id)??[];group.push(m);groups.set(id,group);}
    const counts=new Map(legal.rows.map(r=>[r.property_id,r]));const active=new Set(saved.rows.map(r=>r.property_id));
    for(const p of properties.rows){const id=String(p.id),n=counts.get(id);result.set(id,this.project(p,groups.get(id)??[],n?.total??0,n?.verified??0,active.has(id)));}
    return result;
  }
  async get(c:PoolClient,id:string):Promise<Wire> {
    const result=await c.query<Wire>(`SELECT ${propertyColumns.join(',')} FROM xland.properties WHERE id=$1`,[id]);
    if(!result.rowCount)missing();return this.map(c,result.rows[0]!);
  }
  criteria(q:PropertyQuery,userId:string|null):{where:string;args:unknown[];selected:number} {
    if(q.savedOnly==='true'&&!userId)unauthenticated();
    if(q.districtCode&&!q.provinceCode)invalid('districtCode');
    if(q.minPriceVnd&&q.maxPriceVnd&&BigInt(q.minPriceVnd)>BigInt(q.maxPriceVnd))invalid('maxPriceVnd');
    const clauses=[`p.status='listed'`];const args:unknown[]=[];
    const add=(sql:string,value:unknown)=>{args.push(value);clauses.push(sql.replace('?',`$${args.length}`));};
    let selected=0;
    if(q.query){selected++;add(`(p.title ILIKE ? OR p.code ILIKE $${args.length+1} OR p.province ILIKE $${args.length+1} OR p.district ILIKE $${args.length+1})`,'%'+q.query.replace(/[\\%_]/g,'\\$&')+'%');}
    if(q.regions){selected++;add('p.region=ANY(?::text[])',q.regions);}
    if(q.category){selected++;add('p.category=?',q.category);}
    if(q.provinceCode){selected++;add('p.province_code=?',q.provinceCode);}
    if(q.districtCode){selected++;add('p.district_code=?',q.districtCode);}
    if(q.minPriceVnd||q.maxPriceVnd)selected++;
    if(q.minPriceVnd)add('p.price_total>=?::numeric',q.minPriceVnd);
    if(q.maxPriceVnd)add('p.price_total<=?::numeric',q.maxPriceVnd);
    if(q.areaBands){selected++;const bands:Record<string,string>={below_100:'p.area_m2<100',from_100_to_200:'p.area_m2>=100 AND p.area_m2<=200',above_200:'p.area_m2>200'};clauses.push('('+q.areaBands.map(b=>'('+bands[b]+')').join(' OR ')+')');}
    if(q.landTypes){selected++;add('p.land_type=ANY(?::text[])',q.landTypes);}
    if(q.minRoadWidthM){selected++;add('p.road_width_m>=?::numeric',q.minRoadWidthM);}
    if(q.hasDocuments!==undefined){selected++;clauses.push(`${q.hasDocuments==='false'?'NOT ':''}EXISTS(SELECT 1 FROM xland.property_documents d WHERE d.property_id=p.id)`);}
    if(q.savedOnly==='true')clauses.push('EXISTS(SELECT 1 FROM xland.saved_properties s WHERE s.property_id=p.id)');
    return {where:clauses.join(' AND '),args,selected};
  }
  async search(q:PropertyQuery,userId:string|null,countOnly=false):Promise<Wire> {
    const {where,args,selected}=this.criteria(q,userId);
    const hash=this.cursor.fingerprint({...q,cursor:undefined,limit:undefined,regions:q.regions?.toSorted(),areaBands:q.areaBands?.toSorted(),landTypes:q.landTypes?.toSorted(),userId});
    const ordering:Record<string,{column:string;direction:string;cast:string}>={relevant:{column:'updated_at',direction:'DESC',cast:'timestamptz'},newest:{column:'updated_at',direction:'DESC',cast:'timestamptz'},price_asc:{column:'price_total',direction:'ASC',cast:'numeric'},price_desc:{column:'price_total',direction:'DESC',cast:'numeric'},area_asc:{column:'area_m2',direction:'ASC',cast:'numeric'}};
    const order=ordering[q.sort]!;
    return this.db.transaction('xland_api',userId,async c=>{
      if(q.districtCode){const valid=await c.query('SELECT 1 FROM xland.geo_locations WHERE code=$1 AND parent_code=$2',[q.districtCode,q.provinceCode]);if(!valid.rowCount)invalid('districtCode');}
      const total=Number((await c.query(`SELECT count(*) total FROM xland.properties p WHERE ${where}`,args)).rows[0].total);
      if(countOnly)return {data:{total,selectedCriteriaCount:selected}};
      let after='';const values=[...args];
      if(q.cursor){const decoded=this.cursor.decode(q.cursor,'properties',hash);values.push(decoded.value,decoded.id);after=` AND (p.${order.column},p.id) ${order.direction==='ASC'?'>':'<'} ($${values.length-1}::${order.cast},$${values.length}::uuid)`;}
      values.push(q.limit+1);
      const rows=await c.query<Wire>(`SELECT ${propertyColumns.map(n=>'p.'+n).join(',')},p.${order.column}::text cursor_value FROM xland.properties p WHERE ${where}${after} ORDER BY p.${order.column} ${order.direction},p.id ${order.direction} LIMIT $${values.length}`,values);
      const page=rows.rows.slice(0,q.limit);const last=page.at(-1);const hasMore=rows.rows.length>q.limit;
      const mapped:Wire[]=[];for(const p of page)mapped.push(await this.map(c,p));
      return {data:mapped,meta:{total,selectedCriteriaCount:selected,hasMore,nextCursor:hasMore&&last?this.cursor.encode({scope:'properties',hash,value:String(last.cursor_value),id:String(last.id)}):null}};
    },true);
  }
  async legal(c:PoolClient,id:string):Promise<Wire> {
    await this.get(c,id);
    const items=await c.query(`SELECT id,property_id,title,subtitle,checked_date::text,status,sort_order FROM xland.property_legal_items WHERE property_id=$1 ORDER BY sort_order`,[id]);
    const docs=await c.query(`SELECT id,property_id,title,mime_type,size_bytes,uploaded_date::text,access_level,public_preview_url FROM xland.property_documents WHERE property_id=$1 ORDER BY id`,[id]);
    return {propertyId:id,items:items.rows.map(i=>({id:i.id,propertyId:i.property_id,title:i.title,subtitle:i.subtitle,checkedDate:i.checked_date,status:i.status,sortOrder:i.sort_order})),
      documents:docs.rows.map(d=>({id:d.id,propertyId:d.property_id,title:d.title,mimeType:d.mime_type,sizeBytes:Number(d.size_bytes),uploadedDate:d.uploaded_date,previewUrl:d.public_preview_url,access:d.access_level,canDownload:false})),
      verifiedCount:items.rows.filter(i=>i.status==='verified').length,totalCount:items.rows.length,scopeNotice:'Đối chiếu theo phạm vi hồ sơ; dữ liệu minh họa, không thay thế thẩm định pháp lý.'};
  }
  async area(c:PoolClient,id:string,category?:string):Promise<Wire> {
    const p=await c.query(`SELECT approximate_lat,approximate_lng,approximate_radius_m,district FROM xland.properties WHERE id=$1`,[id]);if(!p.rowCount)missing();
    const row=p.rows[0];
    const amenities=await c.query(`SELECT id,category,name,distance_text,icon_type,approximate_lat,approximate_lng FROM xland.property_nearby_amenities WHERE property_id=$1 AND ($2::text IS NULL OR category=$2) ORDER BY sort_order`,[id,category??null]);
    const photos=await c.query(`SELECT id,kind,public_url,thumbnail_url,alt_text,duration_seconds,is_illustrative FROM xland.property_media WHERE property_id=$1 AND usage='area' ORDER BY sort_order`,[id]);
    return {propertyId:id,location:row.approximate_lat===null||row.approximate_lng===null||row.approximate_radius_m===null?null:{latitude:Number(row.approximate_lat),longitude:Number(row.approximate_lng),radiusM:row.approximate_radius_m,label:row.district+' (vị trí khu vực minh họa)'},
      amenities:amenities.rows.map(a=>({id:a.id,propertyId:id,category:a.category,name:a.name,distanceText:a.distance_text,iconType:a.icon_type,latitude:a.approximate_lat===null?null:Number(a.approximate_lat),longitude:a.approximate_lng===null?null:Number(a.approximate_lng)})),
      photos:photos.rows.map(m=>({id:m.id,kind:m.kind,url:m.public_url,thumbnailUrl:m.thumbnail_url,altText:m.alt_text,durationSeconds:m.duration_seconds,isIllustrative:m.is_illustrative})),providerAttribution:'Bản đồ chưa cấu hình; khoảng cách/vị trí chỉ minh họa',externalMapUrl:null};
  }
  async download(c:PoolClient,propertyId:string,id:string,userId:string|null):Promise<never> {
    const doc=await c.query('SELECT id,access_level FROM xland.property_documents WHERE id=$1 AND property_id=$2',[id,propertyId]);if(!doc.rowCount)missing();
    if(doc.rows[0].access_level!=='public_redacted'){
      if(!userId)unauthenticated();
      if(doc.rows[0].access_level==='granted'){
        const grant=await c.query('SELECT 1 FROM xland.document_access_grants WHERE document_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())',[id]);
        if(!grant.rowCount)throw new DomainError(403,'FORBIDDEN','Chưa có quyền xem tài liệu');
      }
    }
    throw new DomainError(409,'FEATURE_NOT_ENABLED','Nguồn tài liệu chưa được cấu hình');
  }
}
