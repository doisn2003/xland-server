import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const run=JSON.parse(await readFile('.local/p3-context.json','utf8'));
const state=JSON.parse(await readFile('.local/p3-preview.json','utf8'));
const input=JSON.parse(await readFile('.local/p3-w1-input.json','utf8'));
assert.equal(run.sourceHash,state.sourceHash);assert.equal(run.bundleHash,state.bundleHash);
const records:unknown[]=[];let a:string|undefined,b:string|undefined;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function request(path:string,method='GET',body?:unknown,token?:string,key?:string,expected=200){
 const r=await fetch(state.apiBase+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const wire=await r.json();records.push({path,method,status:r.status,requestId:r.headers.get('x-request-id'),payloadHash:path.includes('/auth/')?null:hash(body??null),keyHash:key?hash(key):null,errorCode:wire.error?.code??null});assert.equal(r.status,expected);return wire.data;
}
try{
 a=(await request('/auth/sessions','POST',{username:input.usernameA,password:input.passwordA})).accessToken;
 b=(await request('/auth/sessions','POST',{username:input.usernameB,password:input.passwordB})).accessToken;
 const video=await request('/videos/'+input.videoId);
 await request('/videos/'+input.videoId+'/like','PUT',{},a);await request('/videos/'+input.videoId+'/like','PUT',{},a);
 assert.equal((await request('/videos/'+input.videoId,'GET',undefined,a)).isLiked,true);
 assert.equal((await request('/videos/'+input.videoId,'GET',undefined,b)).isLiked,false);
 await request('/authors/'+video.author.id+'/follow','PUT',{},a);await request('/authors/'+video.author.id+'/follow','PUT',{},a);
 assert((await request('/me/following?limit=50','GET',undefined,a)).some((x:{id:string})=>x.id===video.author.id));
 assert(!(await request('/me/following?limit=50','GET',undefined,b)).some((x:{id:string})=>x.id===video.author.id));
 const payload={kind:'loan_advice',propertyId:input.propertyId,message:'DEMO '+input.runLabel,contactName:'DEMO C W1',contactPhone:input.contactPhone,consentToShareContact:true};
 const key=input.runLabel+'-support-positive';
 const first=await request('/support-requests','POST',payload,a,key,201);
 assert.equal((await request('/support-requests','POST',payload,a,key,201)).id,first.id);assert.equal(first.status,'received');
 assert((await request('/me/support-requests?limit=50','GET',undefined,a)).some((x:{id:string})=>x.id===first.id));
 assert(!(await request('/me/support-requests?limit=50','GET',undefined,b)).some((x:{id:string})=>x.id===first.id));
 await writeFile(resolve(run.evidence,'social-support-api-proof.json'),JSON.stringify({timestamp:new Date().toISOString(),sourceHash:run.sourceHash,bundleHash:run.bundleHash,records,supportId:first.id,retrySameId:true,ownerIsolation:true,scope:'real HTTP/API; not UI proof',mutations:'own A/B synthetic accounts only; no inventory reset'},null,2));
 console.log(JSON.stringify({event:'w1_social_support_api_pass',requests:records.length,retrySameId:true,ownerIsolation:true}));
}catch{await writeFile(resolve(run.evidence,'social-support-api-failure.json'),JSON.stringify({records},null,2));console.error('W1 social/support API proof failed; inspect redacted evidence');process.exitCode=1;}finally{
 for(const token of [a,b])if(token)await request('/auth/sessions/current','DELETE',undefined,token).catch(()=>{});
}
