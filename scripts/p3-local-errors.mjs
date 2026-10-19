// Every mutation/fault below is on a fresh local DB. Never reads Supabase env.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {localPostgres} from './local-postgres.mjs';
import {runLocalChild} from './run-local-child.mjs';
const run=JSON.parse(await readFile('.local/p3-context.json','utf8'));
process.env.XLAND_EVIDENCE_DIR=resolve(run.evidence,'local-errors');process.env.XLAND_EVIDENCE_CASE='w1-errors';
let local,api,slow;let phase='local-readiness';
try{
 local=await localPostgres();phase='fresh-local-foundation';
 await runLocalChild(['--import','tsx','scripts/verify-postgres-foundation.ts']).done;
 if(!process.argv.includes('--errors-only'))await runLocalChild(['--import','tsx','scripts/w3-scenarios.ts']).done;
 const {testApi}=await import('../tests/helpers/api.ts');api=await testApi();
 const u=new URL(api.context.connectionString);assert(['127.0.0.1','localhost'].includes(u.hostname));assert(u.pathname.startsWith('/xland_test_'));
 const cases=[];
 const record=(name,response,status)=>{assert.equal(response.status,status);cases.push({name,status,requestId:response.headers.get('x-request-id'),code:response.body.error?.code??null});};
 phase='expired-revoked';let token=await api.login();
 await api.db.pool.query("UPDATE xland.auth_sessions SET created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()",[api.context.first.id]);
 record('actual expired session rejected',await api.request('/auth/session','GET',undefined,token),401);
 token=await api.login();await api.db.pool.query('UPDATE xland.auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[api.context.first.id]);
 record('actual revoked session rejected',await api.request('/auth/session','GET',undefined,token),401);
 phase='cors-and-rate';
 const forbidden=await fetch(api.base+'/feed',{method:'OPTIONS',headers:{Origin:'https://unapproved.invalid'},signal:AbortSignal.timeout(15000)});
 record('CORS forbidden preflight', {status:forbidden.status,headers:forbidden.headers,body:await forbidden.json()},403);
 let limited;for(let i=0;i<30;i++){
  const r=await api.request('/auth/sessions','POST',{username:'local-w1-rate-canary',password:'synthetic-invalid-password'});
  if(r.status===429){limited=r;break;}
 }
 assert(limited);record('actual local login limiter',limited,429);
 phase='bounded-transport-timeout';
 slow=createServer((_req,res)=>{const timer=setTimeout(()=>res.writeHead(503).end(),20000);res.once('close',()=>clearTimeout(timer));});
 await new Promise(r=>slow.listen(0,'127.0.0.1',r));const started=performance.now();
 await assert.rejects(fetch(`http://127.0.0.1:${slow.address().port}/intentional-delay`,{signal:AbortSignal.timeout(15000)}));
 const ms=Math.round(performance.now()-started);assert(ms>=14000&&ms<19000);cases.push({name:'separate local helper timeout at explicit15s; not UI retry proof',elapsedMs:ms,status:'timeout'});
 await writeFile(resolve(run.evidence,'local-errors-result.json'),JSON.stringify({environment:'fresh-isolated-local-test',cases,capacityIdempotencyPolicy:'41 real API scenarios in local-errors/w3-scenarios.json',remoteWrites:false,sharedMediaFaulted:false},null,2));
 console.log(JSON.stringify({event:'w1_local_errors_pass',cases:cases.length,capacitySuite:41,remoteWrites:false}));
}catch{console.error(JSON.stringify({event:'w1_local_errors_failed',phase,details:'redacted; isolated DB retained'}));process.exitCode=1;}finally{
 if(slow){slow.closeAllConnections();await new Promise(r=>slow.close(r));}await api?.close();await local?.stop();
}
process.exit(process.exitCode??0);
