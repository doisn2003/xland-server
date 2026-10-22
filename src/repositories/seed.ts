import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { Pool, PoolClient } from 'pg';

type Row = Record<string, unknown>;
interface Fixture {
  properties: Row[]; consultants: Row[]; feedVideos: Row[]; legalItems: Row[];
  documents: Row[]; amenities: Row[]; events: Row[]; futureEvents: Row[];
  slots: Row[]; clubs: Row[]; sampleTypes: Record<string, Row>;
}
export interface SeedAccount { id: string; username: string; password: string }

async function insert(c: PoolClient, table: string, fields: Row): Promise<void> {
  if (![table,...Object.keys(fields)].every(s => /^[a-z_][a-z0-9_]*$/.test(s))) throw new Error('Unsafe seed identifier');
  const keys=Object.keys(fields);
  await c.query(`INSERT INTO xland.${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT DO NOTHING`,Object.values(fields));
}
export async function loadFixture(): Promise<Fixture> {
  return JSON.parse(await readFile(new URL('../../fixtures/contract/v0.1.json',import.meta.url),'utf8')) as Fixture;
}
export async function seed(pool: Pool, accounts: SeedAccount[], clock = new Date()): Promise<{ accounts: number; properties: number; videos: number }> {
  if (!accounts.length) throw new Error('Provisioned account credentials must be supplied privately');
  const f=await loadFixture();
  const consultant=f.consultants[0]!;
  const user=f.sampleTypes.UserProfile!;
  const defaultUser=String(user.id);
  const identities=[...accounts];
  for(const id of [String(consultant.id),defaultUser]) {
    if(!identities.some(a=>a.id===id)) identities.push({id,username:'fixture-'+id.slice(-12),password:randomBytes(32).toString('base64url')});
  }
  const hashes=await Promise.all(identities.map(a=>argon2.hash(a.password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1})));
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE xland_seed');
    await c.query('SELECT pg_advisory_xact_lock(783134222)');
    for(let i=0;i<identities.length;i++) {
      const a=identities[i]!;
      const normalized=a.username.trim().toLowerCase();
      if(!/^[a-z0-9._-]{3,64}$/.test(normalized)||[...a.password].length<8||[...a.password].length>128||a.password.includes('\0')) throw new Error('Invalid provisioned account input');
      const existing=await c.query('SELECT id,username_normalized FROM xland.user_identities WHERE username_normalized=$1 OR id=$2',[normalized,a.id]);
      if(existing.rows.some((row: {id:string;username_normalized:string})=>row.id!==a.id||row.username_normalized!==normalized))throw new Error('Seed identity conflict; manual review required');
      await insert(c,'user_identities',{id:a.id,username_normalized:normalized,password_hash:hashes[i],status:accounts.some(x=>x.id===a.id)?'active':'disabled'});
      await insert(c,'user_profiles',{id:a.id,display_name:a.id===consultant.id?'Minh Anh':a.id===defaultUser?'Anh Nam':'Tài khoản kiểm thử',is_illustrative:true});
      await insert(c,'user_contacts',{user_id:a.id,phone:a.id===defaultUser?'0900000678':null});
      await insert(c,'user_settings',{user_id:a.id});
      await insert(c,'user_roles',{user_id:a.id,role:a.id===consultant.id?'consultant':'customer'});
    }
    await insert(c,'consultants',{id:consultant.id,name:consultant.name,role:consultant.role,location:consultant.location,is_verified:consultant.isVerified,video_count:24,follower_count:1200,rating:'4.8',is_illustrative:true});
    for(const p of f.properties) {
      await insert(c,'geo_locations',{code:p.provinceCode,catalog_version:'fixture-2026-09',kind:'province',name:p.provinceName});
      await insert(c,'geo_locations',{code:p.districtCode,catalog_version:'fixture-2026-09',kind:'district',name:p.districtName,parent_code:p.provinceCode,parent_catalog_version:'fixture-2026-09'});
      await insert(c,'properties',{id:p.id,code:p.code,title:p.title,province:p.provinceName,province_code:p.provinceCode,district:p.districtName,district_code:p.districtCode,catalog_version:'fixture-2026-09',region:p.region,category:p.category,price_total:p.priceTotal,area_m2:p.areaM2,frontage_m:p.frontageM,depth_m:p.depthM,road_width_m:p.roadWidthM,direction:p.direction,land_type:p.landType,status:p.status,status_badge:p.sourceBadge,approval_status:p.approvalStatus,consultant_id:p.consultantId,highlights:JSON.stringify(p.highlights),approximate_lat:21,approximate_lng:105.5,approximate_radius_m:2000,is_illustrative:true,updated_at:p.updatedAt});
      for(const [i,m] of (p.media as Row[]).entries()) await insert(c,'property_media',{id:m.id,property_id:p.id,kind:m.kind,usage:'gallery',public_url:null,thumbnail_url:null,alt_text:m.altText,duration_seconds:m.durationSeconds,sort_order:i,is_illustrative:true});
    }
    for(const [i,v]of f.feedVideos.entries()) {
      const m=v.media as Row; const author=v.author as Row;
      await insert(c,'property_media',{id:m.id,property_id:v.propertyId,kind:'video',usage:'feed',public_url:null,thumbnail_url:null,alt_text:m.altText,duration_seconds:m.durationSeconds,sort_order:i,is_illustrative:true});
      await insert(c,'videos',{id:v.id,property_id:v.propertyId,author_id:author.id,media_id:m.id,caption:v.caption,published_at:v.publishedAt,view_count:v.viewCount,is_illustrative:true});
    }
    for(const l of f.legalItems)await insert(c,'property_legal_items',{id:l.id,property_id:l.propertyId,title:l.title,subtitle:l.subtitle,checked_date:l.checkedDate,status:l.status,sort_order:l.sortOrder});
    for(const d of f.documents)await insert(c,'property_documents',{id:d.id,property_id:d.propertyId,title:d.title,file_type:d.mimeType==='application/pdf'?'PDF':'JPG',mime_type:d.mimeType,size_bytes:d.sizeBytes,uploaded_date:d.uploadedDate,storage_key:null,access_level:d.access,public_preview_url:null,is_illustrative:true});
    for(const [i,a]of f.amenities.entries())await insert(c,'property_nearby_amenities',{id:a.id,property_id:a.propertyId,category:a.category,name:a.name,distance_text:a.distanceText,icon_type:a.iconType,sort_order:i});
    for(const e of [...f.events,...f.futureEvents]) {
      const historical=e.status==='closed';
      const original=new Date(String(e.startsAt));
      const starts=historical||original>clock?original:new Date(clock.getTime()+7*86400000);
      const ends=new Date(starts.getTime()+Number(e.durationMinutes)*60000);
      const agenda=(e.agenda as Row[]).map(a=>({...a,startsAt:new Date(new Date(String(a.startsAt)).getTime()+starts.getTime()-original.getTime()).toISOString()}));
      await insert(c,'events',{id:e.id,title:e.title,tags:JSON.stringify(e.tags),media:'[]',starts_at:starts.toISOString(),ends_at:ends.toISOString(),time_zone:e.timeZone,venue_name:e.venueName,address:e.address,max_slots:e.maxSlots,duration_mins:e.durationMinutes,ticket_price:e.ticketPriceVnd,status:e.status,agenda:JSON.stringify(agenda),speakers:JSON.stringify(e.speakers),benefits:JSON.stringify(e.benefits),is_illustrative:true});
    }
    for(const s of f.slots) {
      const original=new Date(String(s.startsAt));
      const starts=original>clock?original:new Date(clock.getTime()+7*86400000);
      const area=s.meetingArea as Row;
      await insert(c,'site_visit_slots',{id:s.id,property_id:s.propertyId,consultant_id:s.consultantId,starts_at:starts.toISOString(),ends_at:new Date(starts.getTime()+90*60000).toISOString(),time_zone:s.timeZone,max_attendees:6,max_bookings:1,status:'open',approximate_meeting_lat:area.latitude,approximate_meeting_lng:area.longitude,radius_m:area.radiusM,label:area.label,is_illustrative:true});
    }
    for(const club of f.clubs)await insert(c,'clubs',{id:club.id,title:club.title,summary:club.summary,description:club.description,region_label:club.regionLabel,activities:JSON.stringify(club.activities),media:'[]',is_illustrative:true});
    const review=f.sampleTypes.ConsultantReview!;
    await insert(c,'consultant_reviews',{id:review.id,consultant_id:review.consultantId,public_author_label:review.authorDisplayName,rating:review.rating,body:review.text,created_at:review.createdAt,is_illustrative:true});
    await c.query('COMMIT');
    return {accounts:accounts.length,properties:f.properties.length,videos:f.feedVideos.length};
  } catch(error) {await c.query('ROLLBACK');throw error;}finally{c.release();}
}

export function randomTestAccount(): SeedAccount { return {id:randomUUID(),username:'test-'+randomBytes(8).toString('hex'),password:randomBytes(24).toString('base64url')}; }
