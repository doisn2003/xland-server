import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AvatarStorage,avatarLimit} from '../../src/services/avatar-storage.js';
import {DomainError} from '../../src/domain/errors.js';
const user='00000000-0000-4000-8000-000000000001';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=';

test('avatar storage provisions a restricted public bucket and uploads with server credentials',async t=>{
  const calls:{url:string;init:RequestInit}[]=[];
  t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{
    calls.push({url,init});
    return Response.json(url.endsWith('/bucket')&&init.method===undefined?[]:{});
  });
  const storage=new AvatarStorage({SUPABASE_URL:'https://project.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_backend_only'});
  const url=await storage.upload(user,{mimeType:'image/png',bytesBase64:png});
  assert.ok(storage.owns(url,user));
  assert.equal(storage.owns(url,'another-user'),false);
  const created=calls.find(c=>c.url.endsWith('/bucket')&&c.init.method==='POST')!;
  assert.deepEqual(JSON.parse(String(created.init.body)),{id:'xland-user-avatars',name:'xland-user-avatars',public:true,file_size_limit:avatarLimit,allowed_mime_types:['image/jpeg','image/png','image/webp']});
  const upload=calls.at(-1)!;
  assert.match(upload.url,new RegExp('/object/xland-user-avatars/'+user+'/[0-9a-f-]+\\.png$'));
  assert.deepEqual(upload.init.body,new Uint8Array(Buffer.from(png,'base64')));
  assert.equal((upload.init.headers as Record<string,string>).apikey,'sb_secret_backend_only');
  assert.equal((upload.init.headers as Record<string,string>).Authorization,undefined);
  assert.ok(!url.includes('sb_secret_'));
  await storage.remove(url,user);
  assert.equal(calls.at(-1)!.init.method,'DELETE');
  const count=calls.length;
  await storage.remove(url,'another-user');
  assert.equal(calls.length,count);
  await storage.upload(user,{mimeType:'image/png',bytesBase64:png});
  assert.equal(calls.filter(c=>c.url.endsWith('/bucket')&&c.init.method==='POST').length,1);
});

test('oversize avatars are rejected before Storage access and unconfigured Storage reports a typed error',async()=>{
  const storage=new AvatarStorage({});
  await assert.rejects(storage.upload(user,{mimeType:'image/png',bytesBase64:Buffer.alloc(avatarLimit+1).toString('base64')}),e=>e instanceof DomainError&&e.status===400);
  await assert.rejects(storage.upload(user,{mimeType:'image/png',bytesBase64:png}),e=>e instanceof DomainError&&e.code==='STORAGE_NOT_CONFIGURED');
});
