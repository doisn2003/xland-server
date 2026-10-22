import {createHash,randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {DomainError} from '../domain/errors.js';
const extensions:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','application/pdf':'pdf'};
export async function verifyUploadBytes(bytes:Buffer,mime:string,size:number,contentType:string){
  const invalid=()=>new DomainError(400,'INVALID_FILE','Nội dung tệp, loại tệp hoặc dung lượng thực không khớp. Vui lòng chọn lại tệp.');
  if(!extensions[mime]||!bytes.length||bytes.length!==size||size>52428800||contentType.split(';')[0]?.trim().toLowerCase()!==mime)throw invalid();
  // Untrusted binary parsing runs off-thread with a hard deadline.
  const detected=await new Promise<string|undefined>((resolve,reject)=>{
    const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');import('file-type').then(async m=>parentPort.postMessage((await m.fileTypeFromBuffer(workerData))?.mime)).catch(()=>parentPort.postMessage(null));`,{eval:true,workerData:bytes});
    const timer=setTimeout(()=>{void worker.terminate();reject(invalid());},10000);
    worker.once('message',value=>{clearTimeout(timer);void worker.terminate();resolve(value);});
    worker.once('error',()=>{clearTimeout(timer);reject(invalid());});
    worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(invalid());}});
  });
  if(detected!==mime)throw invalid();
}
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
      {id:'xland-admin-documents',public:false,file_size_limit:20971520,allowed_mime_types:['application/pdf','image/jpeg','image/png']},
      {id:'xland-admin-staging',public:false,file_size_limit:52428800,allowed_mime_types:Object.keys(extensions)}]){
      const found=buckets.find(b=>b.id===item.id);
      if(found&&found.public!==item.public)throw new Error('Storage bucket visibility mismatch');
      if(!found)await this.request('/bucket',{method:'POST',body:JSON.stringify({...item,name:item.id})});
    }
  }
  async sign(userId:string,mime:string,size:number,privateDocument:boolean){
    if(!extensions[mime]||size<=0||size>(privateDocument?20971520:52428800)||(!privateDocument&&mime==='application/pdf')||(privateDocument&&!['application/pdf','image/jpeg','image/png'].includes(mime)))throw new DomainError(400,'INVALID_FILE','File không hợp lệ. Media tối đa 50 MiB; tài liệu tối đa 20 MiB.');
    const bucket='xland-admin-staging',uploadId=randomUUID();
    const path=`${userId}/${uploadId}.${extensions[mime]}`;
    const data=await(await this.request('/object/upload/sign/'+bucket+'/'+path,{method:'POST',body:'{}'})).json() as {url:string};
    const signedUrl=new URL(this.origin+'/storage/v1'+data.url);
    if(signedUrl.origin!==this.origin)throw new DomainError(502,'STORAGE_ERROR','Đường dẫn tải lên không hợp lệ');
    return {signedUrl:signedUrl.toString(),uploadId,stagingKey:bucket+'/'+path};
  }
  async publish(stagingKey:string,userId:string,mime:string,size:number,privateDocument:boolean){
    if(!stagingKey.startsWith(`xland-admin-staging/${userId}/`)||!/^xland-admin-staging\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]+$/.test(stagingKey)||!stagingKey.endsWith('.'+extensions[mime]))throw new DomainError(400,'INVALID_FILE','Đường dẫn tệp không hợp lệ');
    const response=await this.request('/object/authenticated/'+stagingKey);
    const chunks:Uint8Array[]=[];let length=0;
    const reader=response.body?.getReader();
    if(!reader)throw new DomainError(400,'INVALID_FILE','Tệp chưa được tải lên');
    try{
      for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;
        if(length>size||length>(privateDocument?20971520:52428800))throw new DomainError(400,'INVALID_FILE','Dung lượng thực không khớp dung lượng khai báo');
        chunks.push(part.value);
      }
    }finally{await reader.cancel();}
    const bytes=Buffer.concat(chunks);
    await verifyUploadBytes(bytes,mime,size,response.headers.get('content-type')??'');
    const bucket=privateDocument?'xland-admin-documents':'xland-admin-media';
    const storageKey=`${bucket}/${userId}/${randomUUID()}.${extensions[mime]}`;
    // Publish the exact verified bytes to a new immutable key. The browser's
    // staging token cannot overwrite or recreate this final object.
    await this.request('/object/'+storageKey,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:new Uint8Array(bytes)});
    return {storageKey,publicUrl:privateDocument?null:this.origin+'/storage/v1/object/public/'+storageKey,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
}
