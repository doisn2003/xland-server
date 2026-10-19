// Current-source Android storage/auth proof; fresh isolated local DB only.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {localPostgres} from './local-postgres.mjs';
import {runLocalChild} from './run-local-child.mjs';
const c=JSON.parse(await readFile('.local/p3-context.json','utf8'));
const adb='C:/Users/Admin/AppData/Local/Android/Sdk/platform-tools/adb.exe',serial='emulator-5580',pkg='vn.xland.xland_mobile.cproof';
const call=(args,input)=>execFileSync(adb,['-s',serial,...args],{input,windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:30000,maxBuffer:4*1024*1024});
assert.equal(call(['shell','getprop','ro.boot.qemu.avd_name']).toString().trim(),'Medium_Phone_API_37.0');
let local,api;const records=[];let phase='build';
process.env.XLAND_EVIDENCE_DIR=resolve(c.evidence,'native-session-local');process.env.XLAND_EVIDENCE_CASE='p3-native-session';
try{
 const env={...process.env,FLUTTER_ROOT:c.sdk};for(const key of Object.keys(env))if(/DATABASE|PASSWORD|TOKEN|SEPAY|CURSOR_SECRET/i.test(key))delete env[key];
 const child=spawn(resolve(c.sdk,'bin/cache/dart-sdk/bin/dart.exe'),[resolve(c.sdk,'bin/cache/flutter_tools.snapshot'),'build','apk','--debug','--no-pub','--target-platform','android-x64','--android-project-arg=xlandNativeProof=true','-t','lib/bootstrap/native_storage_proof_main.dart'],{cwd:c.sandbox,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);const timer=setTimeout(()=>child.kill(),300000);
 const exit=await new Promise(r=>child.once('exit',code=>r(code??1)));clearTimeout(timer);await writeFile(resolve(c.evidence,'native-session-build.log'),log);assert.equal(exit,0);
 const apk=resolve(c.sandbox,'build/app/outputs/flutter-apk/app-debug.apk'),bytes=await readFile(apk),sha256=createHash('sha256').update(bytes).digest('hex');
 const path=resolve(c.sandbox,'../artifacts/w1-storage-cproof.apk');await mkdir(resolve(c.sandbox,'../artifacts'),{recursive:true});await copyFile(apk,path);
 call(['install','-r',path]);const artifact={path,sha256,bytes:bytes.length,sourceHash:c.sourceHash,target:'native_storage_proof_main.dart'};
 await writeFile(resolve(c.evidence,'native-session-artifact.json'),JSON.stringify(artifact,null,2));
 phase='local-fixture';local=await localPostgres();await runLocalChild(['--import','tsx','scripts/verify-postgres-foundation.ts']).done;
 const {testApi}=await import('../tests/helpers/api.ts');api=await testApi();
 const port=new URL(api.base).port;
 const proof=async(mode,reason=null)=>{
  const runKey=randomUUID();const input={mode,reason,runKey,apiBaseUrl:`http://10.0.2.2:${port}/api/v1`,username:api.context.first.username,password:api.context.first.password};
  call(['shell','am','force-stop',pkg]);call(['shell',`run-as ${pkg} sh -c 'mkdir -p files; cat > files/c02-input.json'`],Buffer.from(JSON.stringify(input)));
  call(['shell','am','start','-W','-n',pkg+'/vn.xland.xland_mobile.MainActivity']);
  let found=[];const until=Date.now()+30000;
  while(Date.now()<until){await new Promise(r=>setTimeout(r,250));found=call(['logcat','-d','-s','flutter:I']).toString().split('\n').flatMap(line=>{const p=line.indexOf('XLAND_C02 ');if(p<0)return [];try{const r=JSON.parse(line.slice(p+10));return r.runKey===runKey?[r]:[];}catch{return [];}});if(found.length)break;}
  assert(found.length);assert(!found.some(r=>r.mode==='failed'));
  const record=found.find(r=>r.mode===mode);assert(record);
  if(mode==='unavailable')assert.equal(record.actualNoEnrollmentGuarded,true);
  if(mode==='write')assert.equal(record.actualNativeWriteRead,true);
  if(mode==='restart_read_delete'){assert.equal(record.restartRead,true);assert.equal(record.deleteReadNull,true);}
  if(mode==='read_valid'){assert.equal(record.restartSessionRead,true);assert.equal(record.status,200);}
  if(mode==='read_401'){assert.equal(record.status,401);assert.equal(record.nativeReadNull,true);}
  if(mode==='logout')assert.equal(record.nativeReadNull,true);
  records.push(...found);await writeFile(resolve(c.evidence,'native-session-progress.json'),JSON.stringify({artifact,records},null,2));
 };
 phase='native-canary';await proof('write');await proof('restart_read_delete');await proof('unavailable');
 phase='native-session';await proof('login');await proof('read_valid');await proof('logout');
 await proof('login');await api.db.pool.query("UPDATE xland.auth_sessions SET created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()",[api.context.first.id]);await proof('read_401','expired');
 await proof('login');await api.db.pool.query('UPDATE xland.auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()',[api.context.first.id]);await proof('read_401','revoked');
 const audit=(await api.db.pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE revoked_at IS NULL AND expires_at<=now())::int expired,count(*) FILTER(WHERE revoked_at IS NOT NULL)::int revoked,count(*) FILTER(WHERE revoked_at IS NULL AND expires_at>now())::int active FROM xland.auth_sessions WHERE user_id=$1",[api.context.first.id])).rows[0];assert.deepEqual(audit,{total:3,expired:1,revoked:2,active:0});
 call(['shell','am','force-stop',pkg]);call(['shell',`run-as ${pkg} rm -f files/c02-input.json`]);
 await writeFile(resolve(c.evidence,'native-session-proof.json'),JSON.stringify({artifact,records,audit,environment:'fresh-local-test',remoteWrites:false,enrolledLocked:'NotRun; no-enrollment guard is separate',iOS:'NotRun'},null,2));
 console.log(JSON.stringify({event:'w1_current_native_session_pass',records:records.length,audit,sourceHash:c.sourceHash}));
}catch{console.error(JSON.stringify({event:'w1_current_native_session_failed',phase,details:'redacted; inspect progress and preserve target/DB'}));process.exitCode=1;}finally{await api?.close();await local?.stop();}
process.exit(process.exitCode??0);
