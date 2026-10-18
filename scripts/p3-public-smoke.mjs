// W0: public GETs only; no auth, provisioning, migration, seed or mutation.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
const c=JSON.parse(await readFile('.local/p3-context.json','utf8'));
const state=JSON.parse(await readFile('.local/p3-preview.json','utf8'));
assert.equal(state.bundleHash,c.bundleHash);assert.equal(state.sourceHash,c.sourceHash);
const results=[];
async function get(path,expected=200){
 const start=performance.now(),r=await fetch(`http://127.0.0.1:${c.apiPort}${path}`,{signal:AbortSignal.timeout(15000)});
 // Opaque cursor values stay out of evidence; preserve route + shape + request ID.
 results.push({path:path.replace(/cursor=[^&]+/,'cursor=REDACTED'),status:r.status,ms:Math.round(performance.now()-start),requestId:r.headers.get('x-request-id')});
 assert.equal(r.status,expected);return r.json();
}
try{
 await get('/health/ready');const list=await get('/api/v1/properties?limit=50');
 const property=list.data.find(p=>p.code==='XL-028');assert(property);
 await get(`/api/v1/properties/${property.id}`);
 const first=await get('/api/v1/feed?limit=20');assert.equal(first.data.length,20);assert(first.meta.nextCursor);
 const next=await get('/api/v1/feed?limit=20&cursor='+encodeURIComponent(first.meta.nextCursor));
 assert.equal(next.data.length,20);assert(!next.data.some(v=>first.data.some(p=>p.id===v.id)));
 const videos=[];for(const video of first.data.slice(0,2)){
  const detail=await get('/api/v1/videos/'+video.id);assert.equal(detail.data.propertyId,video.propertyId);
  await get('/api/v1/properties/'+video.propertyId);videos.push({id:video.id,propertyId:video.propertyId,wireMediaUrl:video.media.url,demoMediaUrl:`http://127.0.0.1:${c.mediaPort}/demo-video.mp4`,projection:'typed overlay after strict mapper, not an API field rewrite'});
 }
 assert.notEqual(videos[0].propertyId,videos[1].propertyId);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const end=new Date(day+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+30);const to=end.toISOString().slice(0,10);
 const slots=await get(`/api/v1/properties/${property.id}/availability?fromDate=${day}&toDate=${to}`);
 const slot=slots.data.find(s=>s.isAvailable);assert(slot,'No future available slot in current inventory; do not reseed to hide absence');
 const vnDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(slot.startsAt));
 for(const [kind,id] of [['properties',property.id],['consultants',slot.consultantId]]){
  const same=await get(`/api/v1/${kind}/${id}/availability?fromDate=${vnDay}&toDate=${vnDay}`);assert(same.data.some(s=>s.id===slot.id));
 }
 const events=await get('/api/v1/events?limit=10');await get('/api/v1/events/'+events.data[0].id);
 const clubs=await get('/api/v1/clubs?limit=10');await get('/api/v1/clubs/'+clubs.data[0].id);
 await get('/api/v1/me/bookings',401);
 const origin=`http://127.0.0.1:${c.webPort}`;
 const cors=await fetch(`http://127.0.0.1:${c.apiPort}/api/v1/feed?limit=1`,{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});assert.equal(cors.status,200);assert.equal(cors.headers.get('access-control-allow-origin'),origin);
 const media=[];for(const [path,expected]of [['/demo-video.mp4',206],['/expired',410],['/broken',503]]){
  const r=await fetch(`http://127.0.0.1:${c.mediaPort}${path}`,{headers:{Origin:origin,Range:'bytes=0-15'},signal:AbortSignal.timeout(5000)});assert.equal(r.status,expected);assert.equal(r.headers.get('access-control-allow-origin'),origin);
  if(expected===206){assert.equal(r.headers.get('content-type'),'video/mp4');assert.equal((await r.arrayBuffer()).byteLength,16);}
  media.push({path,status:r.status,mime:r.headers.get('content-type'),range:r.headers.get('content-range'),cache:r.headers.get('cache-control')});
 }
 const served=await(await fetch(origin+'/xland-build.json',{signal:AbortSignal.timeout(5000)})).json();assert.equal(served.bundleHash,c.bundleHash);
 const evidence={timestamp:new Date().toISOString(),phase:'P3-W0 public GET only; not W1 UI acceptance',pid:state.pid,backendSourceHash:state.backendSourceHash,sourceHash:c.sourceHash,bundleHash:c.bundleHash,results,videos,availability:{businessTimeZone:'Asia/Ho_Chi_Minh',businessDate:vnDay,slot},events:events.data.map(e=>({id:e.id,startsAt:e.startsAt,timeZone:e.timeZone,remainingSlots:e.remainingSlots,ticketPriceVnd:e.ticketPriceVnd})),clubs:clubs.data.map(x=>({id:x.id,title:x.title})),media,apiCors:origin,remoteWrites:false};
 await writeFile(resolve(c.evidence,'public-get-smoke.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({event:'p3_public_get_pass',requests:results.length,pid:state.pid,sourceHash:c.sourceHash,bundleHash:c.bundleHash,remoteWrites:false}));
}catch{await writeFile(resolve(c.evidence,'public-get-failure.json'),JSON.stringify({results,remoteWrites:false},null,2));console.error('P3 public smoke failed; see redacted evidence; shared preview untouched');process.exitCode=1;}
