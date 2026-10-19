// Actual feed UI errors/retry on a dedicated local listener. No shared faults.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mediaDemoServer} from './media-demo-provider.mjs';
const c=JSON.parse(await readFile('.local/p3-context.json','utf8'));
const adb='C:/Users/Admin/AppData/Local/Android/Sdk/platform-tools/adb.exe',serial='emulator-5580',pkg='vn.xland.xland_mobile.cproof';
const call=(args,input)=>execFileSync(adb,['-s',serial,...args],{input,windowsHide:true,timeout:15000,maxBuffer:16*1024*1024});
assert.equal(call(['shell','getprop','ro.boot.qemu.avd_name']).toString().trim(),'Medium_Phone_API_37.0');
const evidence=resolve(c.evidence,'native-errors');await mkdir(evidence,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const hash=b=>createHash('sha256').update(b).digest('hex');
let mode='normal',runKey='',inputBefore=null,phase='build',installed=false,prefsRestored=false;
const server=mediaDemoServer(),handler=server.listeners('request')[0];server.removeAllListeners('request');
server.on('request',(req,res)=>{if(['expired','unavailable'].includes(mode)){res.writeHead(mode==='expired'?410:503).end();return;}handler(req,res);});
const listen=()=>new Promise((ok,no)=>{server.once('error',no);server.listen(5564,'127.0.0.1',ok);});
const close=()=>new Promise(ok=>{if(!server.listening){ok();return;}server.closeAllConnections();server.close(ok);});
const records=()=>call(['logcat','-d','-s','flutter:I']).toString().split('\n').flatMap(line=>{
 const p=line.indexOf('XLAND_C02 ');if(p<0)return[];try{const r=JSON.parse(line.slice(p+10));return r.runKey===runKey?[r]:[];}catch{return[];}
});
const until=async(predicate,label,ms=45000)=>{const stop=Date.now()+ms;while(Date.now()<stop){if(await predicate())return;await pause(300);}throw Error(label);};
const xml=()=>{call(['shell','uiautomator','dump','/sdcard/xland-a-error.xml']);return call(['shell','cat','/sdcard/xland-a-error.xml']).toString();};
const nodeFor=(tree,text)=>[...tree.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]).find(s=>{
 const value=s.match(/content-desc="([^"]*)"/)?.[1]??s.match(/text="([^"]*)"/)?.[1]??'';
 return value.startsWith(text)||value.startsWith('Tab '+text);
});
const tapNode=node=>{assert(node);const b=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert(b);call(['shell','input','tap',String(Math.round((+b[1]+ +b[3])/2)),String(Math.round((+b[2]+ +b[4])/2))]);};
const tapText=async text=>{tapNode(nodeFor(xml(),text));await pause(900);};
const capture=async(label,extra={})=>{
 const bytes=call(['exec-out','screencap','-p']);await writeFile(resolve(evidence,label+'.png'),bytes);
 const proof={timestamp:new Date().toISOString(),sourceHash:c.sourceHash,runKey,mode,device:serial,records:records().slice(-5),imageSha256:hash(bytes),...extra};
 await writeFile(resolve(evidence,label+'.json'),JSON.stringify(proof,null,2));return proof;
};
const start=async()=>{
 runKey=randomUUID();call(['shell','am','force-stop',pkg]);
 call(['shell',`run-as ${pkg} sh -c 'mkdir -p files; cat > files/c02-input.json'`],Buffer.from(JSON.stringify({runKey,mode:'feed'})));
 call(['shell','am','start','-W','-n',pkg+'/vn.xland.xland_mobile.MainActivity']);
};
let artifact=null,exit=0;const cases=[];
try{
 await listen();
 const env={...process.env,FLUTTER_ROOT:c.sdk};for(const key of Object.keys(env))if(/DATABASE|PASSWORD|TOKEN|SEPAY|CURSOR_SECRET/i.test(key))delete env[key];
 const args=[resolve(c.sdk,'bin/cache/flutter_tools.snapshot'),'build','apk','--debug','--no-pub','--target-platform','android-x64','--android-project-arg=xlandNativeProof=true','-t','lib/bootstrap/native_feed_proof_main.dart','--dart-define=XLAND_REPORT_MODE=true',`--dart-define=XLAND_API_BASE_URL=http://10.0.2.2:${c.apiPort}/api/v1`,'--dart-define=XLAND_DEMO_MEDIA_BASE_URL=http://10.0.2.2:5564'];
 const child=spawn(resolve(c.sdk,'bin/cache/dart-sdk/bin/dart.exe'),args,{cwd:c.sandbox,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 const timer=setTimeout(()=>child.kill(),300000);const code=await new Promise(r=>child.once('exit',v=>r(v??1)));clearTimeout(timer);
 await writeFile(resolve(evidence,'build.log'),log);assert.equal(code,0);
 const apk=resolve(c.sandbox,'build/app/outputs/flutter-apk/app-debug.apk'),bytes=await readFile(apk);
 const path=resolve(c.sandbox,'../artifacts/report-errors-'+hash(bytes).slice(0,12)+'.apk');await copyFile(apk,path);artifact={path,sha256:hash(bytes),sourceHash:c.sourceHash,target:'native_feed_proof_main.dart',mediaBase:'http://10.0.2.2:5564'};
 await writeFile(resolve(evidence,'artifact.json'),JSON.stringify(artifact,null,2));
 try{inputBefore=call(['exec-out','run-as',pkg,'cat','files/c02-input.json']);}catch{/* missing is valid */}
 call(['install','-r',path]);installed=true;phase='restore-guest-baseline';await start();
 await until(()=>records().some(r=>r.players?.some(p=>p.initialized)),'initial video');
 if(records().at(-1)?.players?.some(p=>p.playing)){call(['shell','input','tap','120','750']);await pause(500);}
 // Use observed Android semantics to restore the two preferences changed by
 // the earlier persistence proof. No all-app data clear or session deletion.
 await tapText('Tôi');assert(xml().includes('Chưa đăng nhập'));await tapText('Cài đặt ứng dụng');
 let tree=xml();const autoplay=nodeFor(tree,'Tự động phát video'),mute=nodeFor(tree,'Tắt tiếng mặc định');assert(autoplay&&mute);
 if(!autoplay.includes('checked="true"')){tapNode(autoplay);await pause(1000);}
 tree=xml();if(nodeFor(tree,'Tắt tiếng mặc định').includes('checked="true"')){tapNode(nodeFor(tree,'Tắt tiếng mặc định'));await pause(1000);}
 tree=xml();assert(nodeFor(tree,'Tự động phát video').includes('checked="true"'));assert(nodeFor(tree,'Tắt tiếng mặc định').includes('checked="false"'));
 prefsRestored=true;
 await writeFile(resolve(evidence,'guest-baseline-restored.xml'),tree);
 for(const testMode of ['expired','unavailable','offline']){
  phase=testMode;mode=testMode;if(mode==='offline')await close();
  let status='connection-refused';if(mode!=='offline'){const r=await fetch('http://127.0.0.1:5564/report/coastal.mp4');status=r.status;assert.equal(status,mode==='expired'?410:503);}
  else await assert.rejects(fetch('http://127.0.0.1:5564/report/coastal.mp4'));
  await start();await pause(18000);
  const errorTree=xml();await writeFile(resolve(evidence,testMode+'.xml'),errorTree);
  assert(errorTree.includes('Video tạm thời không khả dụng. Vui lòng thử lại.'));assert(!errorTree.includes('không hỗ trợ định dạng'));assert(!errorTree.includes('http://'));
  await capture(testMode,{httpStatus:status,safeMessage:true});
  mode='normal';if(!server.listening)await listen();tapNode(nodeFor(errorTree,'Thử lại'));
  await until(()=>records().some(r=>r.players?.some(p=>p.initialized&&p.playing&&!p.hasError)),'retry initializes and plays');
  await pause(1500);const proof=await capture('retry-'+testMode);
  assert(proof.records.some(r=>r.players?.some(p=>p.initialized&&p.playing&&p.positionMs>0&&p.volume===1)));
  cases.push({sourceError:testMode,httpStatus:status,safeMessage:true,retryWithoutRestart:true,actualPlaying:true});
  console.log(JSON.stringify({event:'report_native_error_retry_pass',sourceError:testMode}));
 }
}catch(error){exit=1;console.error(JSON.stringify({event:'report_native_error_failed',phase,reason:error.message?.startsWith('Expected')?'assertion':'See scoped evidence; no shared service faulted'}));}
finally{
 await close();
 if(installed){
  call(['shell','am','force-stop',pkg]);
  if(inputBefore)call(['shell',`run-as ${pkg} sh -c 'cat > files/c02-input.json'`],inputBefore);
  else call(['shell','run-as',pkg,'rm','-f','files/c02-input.json']);
  call(['install','-r',c.artifact.path]);
  await writeFile('../xland-mobile/.local/native-installed-artifact.json',JSON.stringify({artifact:c.artifact,sourceHash:c.sourceHash,restoredAfter:'report-native-errors'}));
 }
 await writeFile(resolve(evidence,'result.json'),JSON.stringify({exit,phase,artifact,cases,guestPreferencesRestored:prefsRestored,primaryApkRestored:installed,remoteWrites:false,scope:'actual Android feed UI/VideoPlayer with dedicated helper5564; no shared media5563/remote fault'},null,2));
}
process.exitCode=exit;
