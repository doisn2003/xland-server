import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,unlink,open} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const statePath=resolve('.local/preview.json'),lockPath=resolve('.local/preview.lock');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const emit=(event,extra={})=>console.log(JSON.stringify({time:new Date().toISOString(),event,...extra}));
const command=process.argv[2];
async function control(state,action){return new Promise((ok,fail)=>{const c=net.connect(state.pipe);let data='';c.setTimeout(3000,()=>c.destroy(new Error('CONTROL_TIMEOUT')));c.on('connect',()=>c.write(JSON.stringify({nonce:state.nonce,action})+'\n'));c.on('data',b=>{data+=b;if(data.includes('\n')){c.end();ok(JSON.parse(data));}});c.on('error',fail);});}
async function probe(path){const r=await fetch('http://127.0.0.1:3001'+path,{signal:AbortSignal.timeout(6000)});assert.equal(r.status,200);return r.json();}
async function worker(){
 let configured,server,flutter,controlServer,lock;let stopping=false;const started=Date.now();
 const nonce=randomBytes(24).toString('hex');const pipe=process.platform==='win32'?`\\\\.\\pipe\\xland-preview-${nonce}`:resolve('.local',`preview-${nonce}.sock`);
 const shutdown=async(code)=>{if(stopping)return;stopping=true;const deadline=setTimeout(()=>process.exit(code||1),15000);deadline.unref();
 if(flutter&&flutter.exitCode===null){flutter.stdin.write('q\n');await Promise.race([new Promise(r=>flutter.once('exit',r)),delay(5000)]);if(flutter.exitCode===null)flutter.kill();}
 if(server){server.closeIdleConnections();await new Promise(r=>server.close(r));}if(configured)await configured.close();if(controlServer)controlServer.close();
 if(lock){await unlink(statePath).catch(()=>{});await lock.close();await unlink(lockPath).catch(()=>{});}emit('preview_stopped',{exitCode:code});process.exit(code);};
 process.once('SIGINT',()=>void shutdown(0));process.once('SIGTERM',()=>void shutdown(0));
 const watchdog=setTimeout(()=>{emit('preview_start_timeout');void shutdown(1);},120000);watchdog.unref();
 try{
 await mkdir('.local',{recursive:true});lock=await open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));
 const env={...parseEnv(await readFile('.env.supabase-mock','utf8')),NODE_ENV:'development',BIND_HOST:'127.0.0.1',PORT:'3001'};
 const {databaseTarget}=await import('../src/config/database-target.ts');const target=databaseTarget(env,false);assert.equal(target.environment,'supabase_mock');assert.equal(target.fingerprint,'03d6c297d77a1029');
 env.CORS_ORIGINS='http://localhost:5555,http://127.0.0.1:5555';
 // Check ownership before initializing DB connections. Never adopt/kill an occupied port.
 for(const port of process.argv.includes('--api-only')?[3001]:[3001,5555])await new Promise((ok,fail)=>{const s=net.createServer();s.once('error',fail);s.listen(port,'127.0.0.1',()=>s.close(ok));});
 const {runtime}=await import('../src/runtime.ts');configured=await runtime(env);
 server=await new Promise((ok,fail)=>{const s=configured.app.listen(3001,'127.0.0.1',()=>ok(s));s.once('error',fail);});
 await probe('/health/ready');const list=await probe('/api/v1/properties');const property=list.data.find(p=>p.code==='XL-028');assert(property);await probe('/api/v1/properties/'+property.id);
 for(const [method,expected]of [['equal_installment','10796711'],['declining_balance','14000000']]){
 const r=await fetch('http://127.0.0.1:3001/api/v1/finance/estimates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId:property.id,equityVnd:'1200000000',loanVnd:'1200000000',termMonths:240,annualRatePercent:'9',method}),signal:AbortSignal.timeout(6000)});assert.equal(r.status,200);assert.equal((await r.json()).data.monthlyPaymentVnd,expected);}
 const apiOnly=process.argv.includes('--api-only');
 const demoMedia=process.argv.includes('--demo-media');
 const demoScenario=process.argv.find(a=>a.startsWith('--demo-media-scenario='))?.split('=')[1]??'normal';
 assert(['normal','expired','unavailable'].includes(demoScenario));
 if(demoMedia){const response=await fetch('http://127.0.0.1:5560/demo-video.mp4',{method:'HEAD',signal:AbortSignal.timeout(3000)});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'video/mp4');}
 if(!apiOnly){
 const sdk=process.env.XLAND_FLUTTER_SDK??'C:/Users/Admin/AppData/Local/XLandTools/flutter-3.47.5';
 const childEnv={...process.env,FLUTTER_ROOT:sdk};for(const k of Object.keys(childEnv))if(/DATABASE|CURSOR_SECRET|PASSWORD|TOKEN|SEPAY/i.test(k))delete childEnv[k];
 flutter=spawn(resolve(sdk,'bin/cache/dart-sdk/bin',process.platform==='win32'?'dart.exe':'dart'),[resolve(sdk,'bin/cache/flutter_tools.snapshot'),'run','-d','web-server','--web-hostname=127.0.0.1','--web-port=5555','-t','lib/bootstrap/dev_main.dart','--dart-define=XLAND_API_BASE_URL=http://127.0.0.1:3001/api/v1',...(demoMedia?['--dart-define=XLAND_DEMO_MEDIA_BASE_URL=http://127.0.0.1:5560',`--dart-define=XLAND_DEMO_MEDIA_SCENARIO=${demoScenario}`]:[])],{cwd:resolve('../xland-mobile'),env:childEnv,windowsHide:true,stdio:['pipe','ignore','ignore']});
 flutter.once('error',()=>{emit('flutter_launch_failed');void shutdown(1);});flutter.once('exit',()=>{if(!stopping){emit('flutter_exited');void shutdown(1);}});
 let ready=false;while(Date.now()-started<110000&&!stopping){try{const r=await fetch('http://127.0.0.1:5555',{signal:AbortSignal.timeout(1500)});if(r.ok){ready=true;break;}}catch{/* compiler startup */}await delay(500);}assert(ready);
 }
 controlServer=net.createServer(c=>{let data='';c.setTimeout(3000,()=>c.destroy());c.on('error',()=>{});c.on('data',b=>{data+=b;if(data.length>1024){c.destroy();return;}if(!data.includes('\n'))return;try{const m=JSON.parse(data);if(m.nonce!==nonce){c.destroy();return;}c.end(JSON.stringify({pid:process.pid,status:'ready',action:m.action})+'\n');if(m.action==='stop')void shutdown(0);}catch{c.destroy();}});});
 await new Promise((ok,fail)=>{controlServer.once('error',fail);controlServer.listen(pipe,ok);});
 await writeFile(statePath,JSON.stringify({pid:process.pid,flutterPid:flutter?.pid??null,pipe,nonce,apiOnly,demoMedia,demoScenario,createdAt:new Date().toISOString(),apiBase:'http://127.0.0.1:3001/api/v1',web:apiOnly?null:'http://127.0.0.1:5555',environment:target.environment,fingerprint:target.fingerprint}),{mode:0o600});
 clearTimeout(watchdog);emit('preview_ready',{pid:process.pid,flutterPid:flutter?.pid??null,apiOnly,fingerprint:target.fingerprint,readiness:200,properties:list.meta.total,guestCalculatorMethods:2});
 }catch(e){clearTimeout(watchdog);let existingHealthStatus=null;if(e.code==='EADDRINUSE')try{existingHealthStatus=(await fetch('http://127.0.0.1:3001/health/ready',{signal:AbortSignal.timeout(1500)})).status;}catch{/* occupied port may not be an API */}emit('preview_start_failed',{code:['EADDRINUSE','EEXIST','ENOENT'].includes(e.code)?e.code:'CONFIG_OR_HEALTH_FAILED',existingHealthStatus,action:'inspect service/owned PID; no unknown process killed'});await shutdown(1);}
}
async function main(){
 if(command==='--worker')return worker();
 if(!['start','stop','status'].includes(command)){emit('usage',{command:'node scripts/preview.mjs start [--api-only] | status | stop'});process.exitCode=2;return;}
 if(command!=='start'){let state;try{state=JSON.parse(await readFile(statePath,'utf8'));const result=await control(state,command);emit(command==='stop'?'stop_requested':'preview_status',{pid:result.pid,status:result.status});if(command==='stop'){for(let i=0;i<40;i++){try{await readFile(lockPath);await delay(500);}catch{emit('preview_stop_complete');return;}}throw new Error('STOP_TIMEOUT');}}catch{emit('preview_control_failed',{reason:'No responsive owned preview; inspect private state/lock and PID; no process was killed'});process.exitCode=1;}return;}
 await mkdir('.local',{recursive:true});const log=await open('.local/preview.log','a');const p=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),'--worker',...process.argv.slice(3).filter(a=>a==='--api-only'||a==='--demo-media'||a.startsWith('--demo-media-scenario='))],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});p.unref();await log.close();
 for(let i=0;i<125;i++){try{const state=JSON.parse(await readFile(statePath,'utf8'));if(state.pid!==p.pid)throw new Error('OTHER_OWNER');await control(state,'status');emit('preview_ready',{pid:state.pid,flutterPid:state.flutterPid,apiBase:state.apiBase,web:state.web});return;}catch{/* wait for this worker only */}
 try{process.kill(p.pid,0);}catch{emit('preview_start_failed',{reason:'Worker exited; see redacted .local/preview.log; occupied ports/locks are never killed'});process.exitCode=1;return;}await delay(1000);}
 emit('preview_start_failed',{reason:'Startup exceeded 125 seconds; use owned stop/status and inspect redacted log'});process.exitCode=1;
}
await main().catch(()=>{emit('preview_command_failed');process.exitCode=1;});

