import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parse} from 'dotenv';
import {AdminStorage} from '../src/admin/storage.ts';

// Explicit live Storage smoke. Never reads/writes business rows. The UUID
// namespace and exact object list belong only to this invocation.
const env=parse(await readFile('.env.p3-enrichment','utf8'));
const storage=new AdminStorage(env),actor=randomUUID(),owned=new Set(),checks=[];
const png=await readFile('demo-assets/w4/xland-synthetic.png');
const mp4=await readFile('demo-assets/w4/xland-synthetic.mp4');
const cases=[
  {name:'valid-png',mime:'image/png',bytes:png,valid:true},
  {name:'valid-mp4',mime:'video/mp4',bytes:mp4,valid:true},
  {name:'private-png',mime:'image/png',bytes:png,privateDocument:true,valid:true},
  {name:'text-disguised-as-png',mime:'image/png',bytes:Buffer.from('not an image'),valid:false},
  {name:'empty-after-positive-size',mime:'image/png',bytes:Buffer.alloc(0),size:1,valid:false},
  {name:'actual-size-mismatch',mime:'image/png',bytes:png,size:png.length+1,valid:false},
  {name:'mime-mismatch',mime:'image/png',contentType:'video/mp4',bytes:mp4,valid:false},
];
let cleanupVerified=false;
try{
  for(const item of cases){
    const size=item.size??item.bytes.length;
    const signed=await storage.sign(actor,item.mime,size,!!item.privateDocument);owned.add(signed.stagingKey);
    const put=await fetch(signed.signedUrl,{method:'PUT',headers:{'Content-Type':item.contentType??item.mime,'x-upsert':'false'},body:item.bytes});
    assert.equal(put.status,200,'staging upload '+item.name);
    const stagingPublic=await fetch(storage.origin+'/storage/v1/object/public/'+signed.stagingKey);
    assert.notEqual(stagingPublic.status,200,'staging must remain private');
    const publish=()=>storage.publish(signed.stagingKey,actor,item.mime,size,!!item.privateDocument);
    if(item.valid){
      const final=await publish();owned.add(final.storageKey);
      const read=await storage.request('/object/authenticated/'+final.storageKey);
      assert.deepEqual(Buffer.from(await read.arrayBuffer()),item.bytes,'published bytes');
      const publicRead=await fetch(storage.origin+'/storage/v1/object/public/'+final.storageKey);
      assert.equal(publicRead.status===200,!item.privateDocument,'final visibility');
    }else await assert.rejects(publish,e=>e.code==='INVALID_FILE');
    checks.push({case:item.name,result:'passed'});
  }
}finally{
  for(const key of owned){
    const [bucket,...parts]=key.split('/');
    assert.equal(parts[0],actor,'cleanup only own invocation');
    await storage.request('/object/'+bucket,{method:'DELETE',body:JSON.stringify({prefixes:[parts.join('/')]})});
  }
  for(const bucket of ['xland-admin-staging','xland-admin-media','xland-admin-documents']){
    const list=await (await storage.request('/object/list/'+bucket,{method:'POST',body:JSON.stringify({prefix:actor+'/',limit:100,offset:0})})).json();
    assert.equal(list.filter(x=>x.id).length,0,'owned prefix empty');
  }
  cleanupVerified=true;
  const evidence={at:new Date().toISOString(),checks,cleanupVerified,businessRowsWritten:0};
  await mkdir('.local/admin-tests',{recursive:true});
  await writeFile('.local/admin-tests/storage-fixes.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
}
