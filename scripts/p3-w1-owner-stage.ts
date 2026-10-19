// Own-canary stage control/cleanup. No client/runtime privilege or API delta.
import {readFile,writeFile,open,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parse} from 'dotenv';
import {Database} from '../src/repositories/database.js';
import {databaseTarget} from '../src/config/database-target.js';
type Account={id:string;username:string};
type Journal={runLabel:string;accounts:Account[]};
const c=JSON.parse(await readFile('.local/p3-context.json','utf8'));
const state=JSON.parse(await readFile('.local/p3-preview.json','utf8'));
const mode=process.argv[2],extra=process.argv[3];
const reportJourney=mode==='report-journey';
const auth=JSON.parse(await readFile(reportJourney?'.local/p3-report-authorization.json':'.local/p3-t0-authorization.json','utf8'));
const journal=JSON.parse(await readFile(reportJourney?'.local/p3-report-journal.json':'.local/p3-w1-journal.json','utf8')) as Journal;
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
assert(auth.authorized===true&&auth.sourceHash===c.sourceHash&&auth.bundleHash===c.bundleHash&&auth.backendSourceHash===state.backendSourceHash);
assert.equal(hash(await readFile(auth.reviewPath)),auth.reviewSha256);
assert(journal.runLabel.startsWith('c-p3-')&&journal.accounts.length===2);
const target=databaseTarget(parse(await readFile('.env.supabase-mock','utf8')),false);assert.equal(target.fingerprint,'03d6c297d77a1029');
assert(['owner-a','owner-b','ui-booking','cleanup-known','report-journey'].includes(mode??''));
const lock='.local/p3-owner-stage.lock',db=new Database(target.connectionString,2);
let ownsLock=false,exclusive=false,exit=0;const cleaned:number[]=[];
const readActive=async(a:Account)=>db.transaction('xland_auth',null,async q=>(await q.query('SELECT id,created_at FROM xland.auth_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()',[a.id])).rows,true);
try{
 const handle=await open(lock,'wx');ownsLock=true;await handle.writeFile(JSON.stringify({pid:process.pid,runLabel:journal.runLabel,started:new Date().toISOString()}));await handle.close();
 for(const [i,a]of journal.accounts.entries()){
  assert.equal(a.username,journal.runLabel+'-'+i);
  await db.transaction('xland_auth',null,async q=>assert.equal((await q.query('SELECT username_normalized FROM xland.user_identities WHERE id=$1',[a.id])).rows[0]?.username_normalized,a.username),true);
 }
 if(mode==='cleanup-known'){
  assert(['A','B'].includes(extra??''));const stamp=process.argv[4]!;assert.equal(new Date(stamp).toISOString(),stamp);
  const account=journal.accounts[extra==='A'?0:1]!;
  const count=await db.transaction('xland_auth',null,async q=>{
   const found=await q.query("SELECT id FROM xland.auth_sessions WHERE user_id=$1 AND created_at>=$2::timestamptz AND created_at<$2::timestamptz+interval '1 millisecond' AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",[account.id,stamp]);
   assert(found.rows.length<=1);if(!found.rows.length)return 0;
   return (await q.query('UPDATE xland.auth_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',[found.rows[0].id,account.id])).rowCount;
  });
  await writeFile(resolve(c.evidence,'own-canary-known-cleanup.json'),JSON.stringify({owner:extra,createdAt:stamp,revokedCount:count,scope:'exact known orphan from failed C test; own journal identity verified; cleanup only, not remote fault proof',idempotent:true},null,2));
  console.log(JSON.stringify({event:'own_known_canary_cleanup',owner:extra,count}));
 }else{
  assert(extra===undefined||(mode==='owner-b'&&extra==='--case=profile'));
  for(const a of journal.accounts)assert.equal((await readActive(a)).length,0,'Preserve pre-existing canary session; inspect ownership before stage');
  exclusive=true;
  const child=spawn(process.execPath,[resolve('../xland-mobile/tool/p3-integration-runner.mjs'),mode!,...(extra?[extra]:[])],{windowsHide:true,stdio:'inherit'});
  const timer=setTimeout(()=>child.kill(),(reportJourney?21:11)*60*1000);
  exit=await new Promise<number>((ok,no)=>{child.once('error',no);child.once('exit',v=>ok(v??1));});clearTimeout(timer);
 }
}catch{exit=1;console.error('Own owner-stage refused/failed; target/review/identity/lock/session details redacted; inspect C evidence');}finally{
 if(exclusive){
  // A failed test may have overwritten a prior login token. Stop only this C
  // test app before revoking any new canary session left by the stage.
  if(exit){try{const adb='C:/Users/Admin/AppData/Local/Android/Sdk/platform-tools/adb.exe';const options={windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe'] as ['ignore','pipe','pipe']};assert.equal(execFileSync(adb,['-s','emulator-5580','shell','getprop','ro.boot.qemu.avd_name'],options).toString().trim(),'Medium_Phone_API_37.0');execFileSync(adb,['-s','emulator-5580','shell','am','force-stop','vn.xland.xland_mobile.cproof'],options);}catch{exit=1;}}
  for(const a of journal.accounts){
   const remaining=await readActive(a);
   const count=await db.transaction('xland_auth',null,async q=>remaining.length?(await q.query('UPDATE xland.auth_sessions SET revoked_at=now() WHERE user_id=$1 AND id=ANY($2::uuid[]) AND revoked_at IS NULL',[a.id,remaining.map(r=>r.id)])).rowCount??0:0);
   cleaned.push(count);
  }
  const active=await Promise.all(journal.accounts.map(async a=>(await readActive(a)).length));if(active.some(Boolean))exit=1;
  await writeFile(resolve(c.evidence,'owner-stage-'+mode+'-'+Date.now()+'.json'),JSON.stringify({mode,extra:extra??null,exit,sourceHash:c.sourceHash,bundleHash:c.bundleHash,backendSourceHash:state.backendSourceHash,runnerHash:hash(await readFile(fileURLToPath(import.meta.url))),cleanupCounts:cleaned,remainingActive:active,scope:'exclusive C journal accounts only; cleanup, not fault-injection evidence'},null,2));
 }
 await db.close();if(ownsLock)await unlink(lock);
}
process.exitCode=exit;
