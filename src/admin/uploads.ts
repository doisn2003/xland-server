import type {PoolClient} from 'pg';
import type {Identity} from '../services/auth.js';
import type {AdminStorage} from './storage.js';
import {DomainError} from '../domain/errors.js';

type Row=Record<string,unknown>;
const invalid=(field:string,message='Tệp chưa được xác minh. Tải lại bằng form trước khi lưu.')=>new DomainError(400,'INVALID_FILE',message,[{field,code:'INVALID_FILE'}]);
const managed=/^xland-admin-(media|documents)\//;
export function canonicalStorageKey(key:string){
  return /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(key)&&key.split('/').every(p=>p!=='.'&&p!=='..');
}

export async function authorizeUpload(c:PoolClient,identity:Identity,storage:AdminStorage,mime:string,size:number,privateDocument:boolean){
  const result=await storage.sign(identity.userId,mime,size,privateDocument);
  await c.query('INSERT INTO xland.admin_uploads(id,actor_id,staging_key,mime_type,expected_size,private_document) VALUES($1,$2,$3,$4,$5,$6)',[result.uploadId,identity.userId,result.stagingKey,mime,size,privateDocument]);
  return {uploadId:result.uploadId,signedUrl:result.signedUrl};
}

export async function finalizeUpload(c:PoolClient,identity:Identity,storage:AdminStorage,id:string){
  const row=(await c.query('SELECT * FROM xland.admin_uploads WHERE id=$1 AND actor_id=$2 FOR UPDATE',[id,identity.userId])).rows[0];
  if(!row)throw invalid('uploadId');
  if(row.verified_at)return {storageKey:row.storage_key,publicUrl:row.public_url};
  if(Date.now()-new Date(row.created_at).getTime()>7200000)throw invalid('uploadId','Phiên tải tệp đã hết hạn. Vui lòng tải lại.');
  const result=await storage.publish(row.staging_key,identity.userId,row.mime_type,row.expected_size,row.private_document);
  await c.query('UPDATE xland.admin_uploads SET storage_key=$2,public_url=$3,sha256=$4,verified_at=now() WHERE id=$1',[id,result.storageKey,result.publicUrl,result.sha256]);
  return {storageKey:result.storageKey,publicUrl:result.publicUrl};
}

/** Legacy references can remain unchanged. Every new managed object must have
 * a server verification record; raw staging keys/URLs can never be published. */
export async function validateStorageReferences(c:PoolClient,data:Row,prior:Row={}){
  const pairs:Record<string,string>={storage_key:'public_url',thumbnail_key:'thumbnail_url',public_preview_key:'public_preview_url',avatar_storage_key:'avatar_url'};
  for(const [field,value] of Object.entries(data)){
    if(typeof value!=='string'||!value)continue;
    if(field.endsWith('_key')){
      if(!canonicalStorageKey(value))throw invalid(field,'Storage key phải là đường dẫn chuẩn, không chứa dấu chấm lùi hoặc ký tự mã hóa');
      if(value.startsWith('xland-admin-staging/'))throw invalid(field);
      const urlField=pairs[field],url=urlField?data[urlField]:undefined;
      const changed=value!==prior[field]||(urlField&&url!==prior[urlField])||(field==='storage_key'&&(data.mime_type!==prior.mime_type||data.size_bytes!==prior.size_bytes||data.kind!==prior.kind));
      if(managed.test(value)&&changed){
        const file=(await c.query('SELECT * FROM xland.admin_uploads WHERE storage_key=$1 AND verified_at IS NOT NULL',[value])).rows[0];
        if(!file||(url!==undefined&&url!==file.public_url))throw invalid(field);
        if(field==='storage_key'&&((data.mime_type!==undefined&&data.mime_type!==file.mime_type)||(data.size_bytes!==undefined&&String(data.size_bytes)!==String(file.expected_size))))throw invalid(field,'Loại hoặc dung lượng hồ sơ không khớp tệp đã xác minh');
        if(field==='storage_key'&&data.kind!==undefined&&!String(file.mime_type).startsWith(String(data.kind)+'/'))throw invalid(field,'Loại media không khớp nội dung tệp');
      }
    }
    if(field.endsWith('_url')){
      let pathname:string;
      try{pathname=decodeURIComponent(new URL(value).pathname);}catch{throw invalid(field);}
      if(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/xland-admin-/.test(pathname)){
        if(pathname.includes('/xland-admin-staging/'))throw invalid(field);
        if(value!==prior[field]&&!(await c.query('SELECT 1 FROM xland.admin_uploads WHERE public_url=$1 AND verified_at IS NOT NULL',[value])).rowCount)throw invalid(field);
      }
    }
  }
  // JSON galleries and speaker avatars must use the same verified-upload gate.
  for(const field of ['media','speakers'])if(Array.isArray(data[field])){
    const before=Array.isArray(prior[field])?prior[field] as Row[]:[];
    for(const [index,item] of (data[field] as Row[]).entries())for(const urlField of ['url','thumbnailUrl','avatarUrl']){
      await validateStorageReferences(c,{asset_url:item[urlField]},{asset_url:before[index]?.[urlField]});
    }
  }
}
