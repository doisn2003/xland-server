import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mediaDemoServer,mediaProvenance} from './media-demo-provider.mjs';
test('synthetic MP4 source, byte ranges, CORS, MIME/cache, expiry and errors',async()=>{
 const now=Date.now();const server=mediaDemoServer({now:()=>now});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
 const full=await fetch(base+'/demo-video.mp4',{headers:{Origin:'http://127.0.0.1:5555'}});assert.equal(full.status,200);assert.equal(full.headers.get('Content-Type'),'video/mp4');assert.equal(full.headers.get('Cache-Control'),'no-store');assert.equal(full.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:5555');const bytes=Buffer.from(await full.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),mediaProvenance.files[0].sha256);assert(bytes.indexOf('moov')<bytes.indexOf('mdat'));assert.equal(mediaProvenance.legalEvidence,false);
 for(const [range,length]of [['bytes=0-31',32],['bytes=-16',16],['bytes=10-',bytes.length-10],['bytes=0-99999999',bytes.length]]){const r=await fetch(base+'/demo-video.mp4',{headers:{Range:range}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,length);assert(r.headers.get('Content-Range'));}
 const head=await fetch(base+'/demo-video.mp4',{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('Content-Length')),bytes.length);assert.equal((await head.arrayBuffer()).byteLength,0);
 for(const range of ['bytes=999999-','bytes=20-10','bytes=0-1,3-4'])assert.equal((await fetch(base+'/demo-video.mp4',{headers:{Range:range}})).status,416);
 assert.equal((await fetch(base+'/demo-video.mp4',{headers:{Origin:'https://unapproved.example'}})).status,403);
 assert.equal((await fetch(base+'/demo-video.mp4',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5555'}})).status,204);
 assert.equal((await fetch(base+'/demo-poster.png')).headers.get('Content-Type'),'image/png');
 assert.equal((await fetch(base+'/demo-video.mp4?expires='+Math.floor(now/1000))).status,410);
 assert.equal((await fetch(base+'/demo-video.mp4?expires='+(Math.floor(now/1000)+300))).status,200);
 assert.equal((await fetch(base+'/demo-video.mp4?expires='+(Math.floor(now/1000)+301))).status,400);
 assert.equal((await fetch(base+'/expired')).status,410);assert.equal((await fetch(base+'/broken')).status,503);assert.equal((await fetch(base+'/missing')).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 await assert.rejects(fetch(base+'/demo-video.mp4',{signal:AbortSignal.timeout(1000)}));
});
