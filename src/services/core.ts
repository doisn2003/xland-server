import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Database } from '../repositories/database.js';
import { PropertyRepository, type Wire } from '../repositories/properties.js';
import type { AuthService, Identity } from './auth.js';
import type { CursorCodec } from './cursor.js';
import { DomainError, missing, unauthenticated } from '../domain/errors.js';

export class CoreService {
  readonly properties:PropertyRepository;
  constructor(readonly db:Database,readonly auth:AuthService,readonly cursor:CursorCodec,readonly now:()=>Date=()=>new Date(),readonly publicBaseUrl?:string) {
    this.properties=new PropertyRepository(db,cursor);
  }
  user(identity:Identity|null):string {if(!identity)unauthenticated();return identity.userId;}
  read<T>(identity:Identity|null,work:(c:PoolClient)=>Promise<T>):Promise<T> {return this.db.transaction('xland_api',identity?.userId??null,work,true);}
  write<T>(identity:Identity|null,work:(c:PoolClient)=>Promise<T>):Promise<T> {return this.db.transaction('xland_api',this.user(identity),work);}
  async savedProperty(identity:Identity|null,id:string,active:boolean):Promise<Wire> {
    return this.write(identity,async c=>{
      await this.properties.get(c,id);
      if(active)await c.query('INSERT INTO xland.saved_properties(user_id,property_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[this.user(identity),id]);
      else await c.query('DELETE FROM xland.saved_properties WHERE property_id=$1',[id]);
      return {active,count:null};
    });
  }
  async catalog(identity:Identity|null,provinceCode?:string):Promise<Wire> {
    return this.read(identity,async c=>{
      const provinces=await c.query(`SELECT code,name FROM xland.geo_locations WHERE kind='province' ORDER BY name,code`);
      if(provinceCode&&!provinces.rows.some(p=>p.code===provinceCode))throw new DomainError(400,'INVALID_INPUT','Tỉnh thành không có trong catalog');
      const districts=await c.query(`SELECT code,name,parent_code FROM xland.geo_locations WHERE kind='district' AND ($1::text IS NULL OR parent_code=$1) ORDER BY name,code`,[provinceCode??null]);
      return {provinces:provinces.rows.map(p=>({code:p.code,label:p.name,parentCode:null})),districts:districts.rows.map(d=>({code:d.code,label:d.name,parentCode:d.parent_code})),minBudgetVnd:'500000000',openUpperBudgetVnd:'10000000000'};
    });
  }
  async share(identity:Identity|null,kind:'properties'|'videos'|'events',id:string):Promise<Wire> {
    await this.read(identity,async c=>{
      const row=await c.query(`SELECT id FROM xland.${kind} WHERE id=$1`,[id]);if(!row.rowCount)missing();
    });
    if(!this.publicBaseUrl)throw new DomainError(409,'FEATURE_NOT_ENABLED','Liên kết chia sẻ chưa có host công khai');
    return {url:new URL(`${kind}/${id}`,this.publicBaseUrl.replace(/\/?$/,'/')).toString(),title:'XLand — thông tin minh họa'};
  }
  async idempotent(c:PoolClient,identity:Identity,operation:string,key:string,body:unknown,create:()=>Promise<{id:string;data:Wire}>):Promise<Wire> {
    if(!/^[\x21-\x7e]{16,128}$/.test(key))throw new DomainError(400,'INVALID_INPUT','Cần Idempotency-Key hợp lệ');
    const hash=this.cursor.fingerprint(body);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[identity.userId+operation+key]);
    const old=await c.query('SELECT request_hash,response_public FROM xland.idempotency_records WHERE user_id=$1 AND operation=$2 AND key=$3',[identity.userId,operation,key]);
    const scope=identity.userId+':'+operation+':'+key;
    if(old.rowCount){if(old.rows[0].request_hash!==hash)throw new DomainError(409,'IDEMPOTENCY_CONFLICT','Idempotency-Key đã dùng cho nội dung khác');return this.cursor.open(old.rows[0].response_public as Record<string,string>,scope) as Wire;}
    const created=await create();
    // Authenticated ciphertext preserves the original retry response without raw contacts in this cache.
    await c.query(`INSERT INTO xland.idempotency_records(user_id,operation,key,request_hash,resource_id,response_status,response_public,expires_at)
      VALUES($1,$2,$3,$4,$5,201,$6,$7)`,[identity.userId,operation,key,hash,created.id,JSON.stringify(this.cursor.seal(created.data,scope)),new Date(this.now().getTime()+86400000)]);
    return created.data;
  }
  newId():string {return randomUUID();}
}
