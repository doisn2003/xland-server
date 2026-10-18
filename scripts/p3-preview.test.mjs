import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {staticBundle} from './p3-preview.mjs';
import {mediaDemoServer} from './media-demo-provider.mjs';
test('isolated static bundle serves actual bytes/MIME and rejects writes/missing/traversal',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'xland-p3-'));
 const server=staticBundle(dir);
 try{
  await writeFile(resolve(dir,'index.html'),'DEMO frozen bundle');await writeFile(resolve(dir,'main.dart.js'),'/* actual compiled bytes */');
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal(await(await fetch(base)).text(),'DEMO frozen bundle');
  const js=await fetch(base+'/main.dart.js');assert.equal(js.headers.get('content-type'),'text/javascript');assert.equal(js.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base,{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/missing')).status,404);
  assert.equal((await fetch(base+'/%2e%2e%5csecret')).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));assert(dir.startsWith(resolve(tmpdir(),'xland-p3-')));await rm(dir,{recursive:true});}
});
test('P3 media allowlist independent of legacy origin, range and expiry still enforced',async()=>{
 const origin='http://127.0.0.1:5557',server=mediaDemoServer({allowedOrigins:[origin]});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const r=await fetch(base+'/demo-video.mp4',{headers:{Origin:origin,Range:'bytes=0-15'}});assert.equal(r.status,206);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.equal((await r.arrayBuffer()).byteLength,16);
  assert.equal((await fetch(base+'/demo-video.mp4',{headers:{Origin:'http://127.0.0.1:5555'}})).status,403);
  assert.equal((await fetch(base+'/expired')).status,410);assert.equal((await fetch(base+'/broken')).status,503);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
