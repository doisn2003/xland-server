import {randomUUID} from 'node:crypto';
import {AdminStorage,verifyUploadBytes} from '../admin/storage.js';
import {DomainError} from '../domain/errors.js';

export const avatarLimit=5*1024*1024;
const bucket='xland-user-avatars';
const extensions:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
export type AvatarInput={mimeType:string;bytesBase64:string};

export class AvatarStorage extends AdminStorage {
  private ready:Promise<void>|undefined;
  private ensureBucket():Promise<void>{
    return this.ready??=(async()=>{
      const buckets=await(await this.request('/bucket')).json() as {id:string;public:boolean}[];
      const found=buckets.find(b=>b.id===bucket);
      if(found&&!found.public)throw new DomainError(503,'STORAGE_ERROR','Kho ảnh đại diện chưa được cấu hình công khai');
      if(!found){
        try{await this.request('/bucket',{method:'POST',body:JSON.stringify({id:bucket,name:bucket,public:true,file_size_limit:avatarLimit,allowed_mime_types:Object.keys(extensions)})});}
        catch(error){
          const existing=await(await this.request('/bucket/'+bucket)).json() as {public:boolean};
          if(!existing.public)throw error;
        }
      }
    })().catch(error=>{this.ready=undefined;throw error;});
  }
  async upload(userId:string,input:AvatarInput):Promise<string>{
    const bytes=Buffer.from(input.bytesBase64,'base64');
    if(!extensions[input.mimeType]||!bytes.length||bytes.length>avatarLimit||bytes.toString('base64')!==input.bytesBase64)throw new DomainError(400,'INVALID_FILE','Chọn ảnh JPG, PNG hoặc WebP, tối đa 5 MB');
    await verifyUploadBytes(bytes,input.mimeType,bytes.length,input.mimeType);
    await this.ensureBucket();
    const key=`${bucket}/${userId}/${randomUUID()}.${extensions[input.mimeType]}`;
    await this.request('/object/'+key,{method:'POST',headers:{'Content-Type':input.mimeType,'x-upsert':'false'},body:new Uint8Array(bytes)});
    return this.origin+'/storage/v1/object/public/'+key;
  }
  owns(url:string,userId:string):boolean{
    if(!this.origin)return false;
    const prefix=this.origin+'/storage/v1/object/public/'+bucket+'/'+userId+'/';
    return url.startsWith(prefix)&&/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(url.slice(prefix.length));
  }
  async remove(url:string,userId:string):Promise<void>{
    if(this.owns(url,userId))await this.request('/object/'+bucket,{method:'DELETE',body:JSON.stringify({prefixes:[url.split('/').slice(-2).join('/')]})});
  }
}
