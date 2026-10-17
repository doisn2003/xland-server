import {readFile,appendFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
const run=JSON.parse(await readFile('.local/closeout02-run.json','utf8'));
assert(resolve(run.evidence).startsWith(resolve('../brain/logs/agent-c/evidence/P2-CLOSEOUT-02')+sep));
const {mode}=JSON.parse(await readFile('.local/native-media-mode.json','utf8'));
let status=null,errorCode=null;
for(let i=0;i<10;i++){
 status=null;errorCode=null;
 try{const r=await fetch('http://127.0.0.1:5562/demo-video.mp4',{method:'HEAD',signal:AbortSignal.timeout(2000)});status=r.status;}catch(e){errorCode=e.cause?.code??e.name;}
 if(mode==='offline'?errorCode==='ECONNREFUSED':status==={normal:200,expired:410,unavailable:503}[mode])break;
 await new Promise(r=>setTimeout(r,200));
}
if(mode==='offline')assert.equal(errorCode,'ECONNREFUSED');else assert.equal(status,{normal:200,expired:410,unavailable:503}[mode]);
const state={timestamp:new Date().toISOString(),mode,status,errorCode,port:5562,sharedMedia5560Untouched:true};
await appendFile(resolve(run.evidence,'native-media-state.jsonl'),JSON.stringify(state)+'\n');console.log(JSON.stringify(state));
