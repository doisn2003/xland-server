import {randomUUID} from 'node:crypto';
import {DomainError} from '../domain/errors.js';
const extensions:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','application/pdf':'pdf'};
export class AdminStorage {
  readonly origin:string;
  readonly key:string;
  constructor(env:NodeJS.ProcessEnv){this.origin=env.SUPABASE_URL?new URL(env.SUPABASE_URL).origin:'';this.key=env.SUPABASE_SECRET_KEY??env.SUPABASE_SERVICE_ROLE_KEY??'';}
  async request(path:string,init:RequestInit={}){
    if(!this.origin||!this.key)throw new DomainError(503,'STORAGE_NOT_CONFIGURED','Chưa cấu hình Supabase Storage ở backend');
    const headers:Record<string,string>={apikey:this.key,'Content-Type':'application/json'};
    if(!this.key.startsWith('sb_secret_'))headers.Authorization='Bearer '+this.key;
    const response=await fetch(this.origin+'/storage/v1'+path,{...init,headers:{...headers,...init.headers},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new DomainError(502,'STORAGE_ERROR','Không thể kết nối kho lưu trữ. Kiểm tra cấu hình bucket hoặc thử lại.');
    return response;
  }
  async setup(){
    const buckets=await(await this.request('/bucket')).json() as {id:string;public:boolean}[];
    for(const item of [{id:'xland-admin-media',public:true,file_size_limit:52428800,allowed_mime_types:['image/jpeg','image/png','image/webp','video/mp4','video/webm']},
      {id:'xland-admin-documents',public:false,file_size_limit:20971520,allowed_mime_types:['application/pdf','image/jpeg','image/png']}]){
      const found=buckets.find(b=>b.id===item.id);
      if(found&&found.public!==item.public)throw new Error('Storage bucket visibility mismatch');
      if(!found)await this.request('/bucket',{method:'POST',body:JSON.stringify({...item,name:item.id})});
    }
  }
  async sign(userId:string,mime:string,size:number,privateDocument:boolean){
    if(!extensions[mime]||size<=0||size>(privateDocument?20971520:52428800)||(!privateDocument&&mime==='application/pdf')||(privateDocument&&!['application/pdf','image/jpeg','image/png'].includes(mime)))throw new DomainError(400,'INVALID_FILE','File không hợp lệ. Media tối đa 50 MiB; tài liệu tối đa 20 MiB.');
    const bucket=privateDocument?'xland-admin-documents':'xland-admin-media';
    const path=`${userId}/${randomUUID()}.${extensions[mime]}`;
    const data=await(await this.request('/object/upload/sign/'+bucket+'/'+path,{method:'POST',body:'{}'})).json() as {url:string};
    const signedUrl=new URL(this.origin+'/storage/v1'+data.url);
    if(signedUrl.origin!==this.origin)throw new DomainError(502,'STORAGE_ERROR','Đường dẫn tải lên không hợp lệ');
    return {signedUrl:signedUrl.toString(),storageKey:bucket+'/'+path,publicUrl:privateDocument?null:this.origin+'/storage/v1/object/public/'+bucket+'/'+path};
  }
}
