import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testApi} from '../helpers/api.js';
import {AvatarStorage} from '../../src/services/avatar-storage.js';
import {DomainError} from '../../src/domain/errors.js';
import type {Wire} from '../../src/repositories/properties.js';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=';
class Storage extends AvatarStorage {
  readonly files=new Map<string,Uint8Array>();
  fail=false;
  constructor(){super({SUPABASE_URL:'https://avatars.example.test',SUPABASE_SECRET_KEY:'sb_secret_test'});}
  override async request(path:string,init:RequestInit={}){
    if(this.fail)throw new DomainError(502,'STORAGE_ERROR','Không thể tải ảnh lên');
    if(path==='/bucket')return Response.json([{id:'xland-user-avatars',public:true}]);
    if(init.method==='POST')this.files.set(path.slice('/object/'.length),init.body as Uint8Array);
    if(init.method==='DELETE')for(const key of (JSON.parse(String(init.body)) as {prefixes:string[]}).prefixes)this.files.delete('xland-user-avatars/'+key);
    return Response.json({});
  }
}

test('optional user profile persists private address and verified Storage avatars atomically',async t=>{
  const storage=new Storage(),api=await testApi(storage);
  try{
    const token=await api.login(),other=await api.login(api.context.second);
    const get=async(auth=token)=>(await api.request('/me/profile','GET',undefined,auth)).body.data as Wire;
    await t.test('requires authentication; all fields can be omitted or cleared',async()=>{
      assert.equal((await api.request('/me/profile','PATCH',{})).status,401);
      assert.equal((await api.request('/me/profile','PATCH',{},token)).status,200);
      const result=await api.request('/me/profile','PATCH',{displayName:'',contactPhone:null,address:null,avatarUrl:null},token);
      assert.equal(result.status,200);
      assert.equal((result.body.data as Wire).displayName,'');
      assert.equal((await get()).address,null);
    });
    await t.test('address is trimmed, persists across session reads and belongs only to its owner',async()=>{
      await api.db.pool.query('UPDATE xland.user_contacts SET phone_verified_at=now() WHERE user_id=$1',[api.context.first.id]);
      const result=await api.request('/me/profile','PATCH',{displayName:'  Nguyễn An  ',address:'  12 Nguyễn Huệ, TP.HCM  '},token);
      assert.equal(result.status,200);
      assert.equal((result.body.data as Wire).address,'12 Nguyễn Huệ, TP.HCM');
      assert.equal((result.body.data as Wire).contactVerified,true);
      const session=(await api.request('/auth/session','GET',undefined,token)).body.data as Wire;
      assert.equal((session.profile as Wire).address,'12 Nguyễn Huệ, TP.HCM');
      assert.equal((await get(other)).address,null);
      await api.service.write(await api.service.auth.identify('Bearer '+other),async c=>{
        assert.equal((await c.query('SELECT address FROM xland.user_contacts WHERE user_id=$1',[api.context.first.id])).rowCount,0);
      });
    });
    await t.test('uploads actual bytes, replaces and clears only owned images',async()=>{
      // Exercise the profile-only parser above the ordinary 64 KiB JSON limit.
      const image=Buffer.concat([Buffer.from(png,'base64'),Buffer.alloc(70000)]);
      const result=await api.request('/me/profile','PATCH',{avatar:{mimeType:'image/png',bytesBase64:image.toString('base64')},address:'Địa chỉ mới'},token);
      assert.equal(result.status,200);
      const url=String((result.body.data as Wire).avatarUrl);
      assert.ok(storage.owns(url,api.context.first.id));
      assert.equal(storage.files.size,1);
      assert.deepEqual([...storage.files.values()][0],new Uint8Array(image));
      const second=await api.request('/me/profile','PATCH',{avatar:{mimeType:'image/png',bytesBase64:png}},token);
      assert.equal(second.status,200);
      assert.notEqual((second.body.data as Wire).avatarUrl,url);
      assert.equal(storage.files.size,1);
      assert.equal((await get()).address,'Địa chỉ mới');
      assert.equal((await api.request('/me/profile','PATCH',{avatarUrl:null,address:null,contactPhone:''},token)).status,200);
      assert.equal(storage.files.size,0);
      assert.equal((await get()).avatarUrl,null);
      assert.equal((await get()).address,null);
    });
    await t.test('invalid uploads and storage failures leave all saved fields intact',async()=>{
      const before=await get();
      for(const avatar of [{mimeType:'image/png',bytesBase64:Buffer.from('fake').toString('base64')},{mimeType:'image/svg+xml',bytesBase64:png},{mimeType:'image/jpeg',bytesBase64:png},{mimeType:'image/png',bytesBase64:'!!'+png}]){
        assert.equal((await api.request('/me/profile','PATCH',{displayName:'Không được lưu',avatar},token)).status,400);
      }
      assert.equal((await api.request('/me/profile','PATCH',{address:'x'.repeat(501)},token)).status,400);
      assert.equal((await api.request('/me/profile','PATCH',{avatarUrl:null,avatar:{mimeType:'image/png',bytesBase64:png}},token)).status,400);
      storage.fail=true;
      assert.equal((await api.request('/me/profile','PATCH',{displayName:'Không được lưu',avatar:{mimeType:'image/png',bytesBase64:png}},token)).status,502);
      assert.deepEqual(await get(),before);
      storage.fail=false;
    });
    await t.test('a database failure rolls back profile fields and removes the newly uploaded object',async()=>{
      const before=await get();
      await api.db.pool.query("ALTER TABLE xland.user_contacts ADD CONSTRAINT qa_profile_rollback CHECK(address <> 'QA force rollback')");
      try{
        assert.equal((await api.request('/me/profile','PATCH',{displayName:'Không được lưu',address:'QA force rollback',avatar:{mimeType:'image/png',bytesBase64:png}},token)).status,500);
        assert.deepEqual(await get(),before);
        assert.equal(storage.files.size,0);
      }finally{await api.db.pool.query('ALTER TABLE xland.user_contacts DROP CONSTRAINT qa_profile_rollback');}
    });
  }finally{await api.close();}
});
