// Independent owned P3 instance. Legacy preview.json/PID19824 are never controlled.
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,open,unlink,readdir} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {mediaDemoServer} from './media-demo-provider.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const statePath=resolve('.local/p3-preview.json'),lockPath=resolve('.local/p3-preview.lock');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const sha=b=>createHash('sha256').update(b).digest('hex');
const emit=(event,extra={})=>console.log(JSON.stringify({time:new Date().toISOString(),event,...extra}));
export async function sourceFiles(directory,part=''){
 const result=[];for(const d of await readdir(resolve(directory,part),{withFileTypes:true})){
  const path=part?`${part}/${d.name}`:d.name;
  if(d.isDirectory())result.push(...await sourceFiles(directory,path));else if(d.isFile())result.push({path,sha256:sha(await readFile(resolve(directory,path)))});
 }return result.sort((a,b)=>a.path.localeCompare(b.path));
}
export function staticBundle(bundle){
 const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.bin':'application/octet-stream'};
 return createServer((req,res)=>{void(async()=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(bundle,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(bundle+sep)){res.writeHead(404).end();return;}
  try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store','X-Xland-Mode':'DEMO-W0'});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404).end();}
 })().catch(()=>{if(!res.headersSent)res.writeHead(400);res.end();});});
}
async function control(state,action){return new Promise((ok,fail)=>{
 const c=net.connect(state.pipe);let data='';c.setTimeout(3000,()=>c.destroy(Error('CONTROL_TIMEOUT')));
 c.on('connect',()=>c.write(JSON.stringify({nonce:state.nonce,action})+'\n'));c.on('data',b=>{data+=b;if(data.includes('\n')){c.end();try{ok(JSON.parse(data));}catch{fail(Error('CONTROL_PROTOCOL'));}}});c.on('error',fail);
});}
const command=process.argv[2];
async function worker(){
 let lock,runtime,controlServer;const servers=[];let stopping=false;
 async function stop(code){if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(code||1),15000);timer.unref();
  await Promise.all(servers.map(s=>new Promise(r=>{s.closeIdleConnections();s.close(r);})));await runtime?.close();controlServer?.close();
  if(lock){await unlink(statePath).catch(()=>{});await lock.close();await unlink(lockPath).catch(()=>{});}emit('p3_stopped',{exitCode:code});process.exit(code);
 }
 process.once('SIGINT',()=>void stop(0));process.once('SIGTERM',()=>void stop(0));
 const watchdog=setTimeout(()=>{emit('p3_start_timeout');void stop(1);},90000);watchdog.unref();
 try{
  await mkdir('.local',{recursive:true});lock=await open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid}));
  const c=JSON.parse(await readFile('.local/p3-context.json','utf8'));
  assert.equal(c.instance,'p3w0');assert.deepEqual([c.apiPort,c.webPort,c.mediaPort],[3002,5557,5563]);
  assert(resolve(c.bundle).startsWith(resolve('../xland-mobile/.local/p3')+sep));
  const build=JSON.parse(await readFile(resolve(c.bundle,'xland-build.json'),'utf8'));assert.equal(build.bundleHash,c.bundleHash);assert.equal(build.sourceHash,c.sourceHash);assert.equal(sha(JSON.stringify(build.files)),build.bundleHash);
  const files=(await sourceFiles(c.bundle)).filter(f=>f.path!=='xland-build.json');
  // Compare each file; ordering is only for the published manifest hash.
  assert.equal(files.length,build.files.length);for(const f of build.files)assert.equal(files.find(v=>v.path===f.path)?.sha256,f.sha256);
  const backend=await sourceFiles(resolve('src'));const backendSourceHash=sha(JSON.stringify(backend));
  const env={...parseEnv(await readFile('.env.supabase-mock','utf8')),NODE_ENV:'development',BIND_HOST:'127.0.0.1',PORT:String(c.apiPort),CORS_ORIGINS:`http://127.0.0.1:${c.webPort},http://localhost:${c.webPort}`};
  const {databaseTarget}=await import('../src/config/database-target.ts');const target=databaseTarget(env,false);assert.equal(target.environment,'supabase_mock');assert.equal(target.fingerprint,'03d6c297d77a1029');
  for(const port of [c.apiPort,c.webPort,c.mediaPort])await new Promise((ok,fail)=>{const probe=net.createServer();probe.once('error',fail);probe.listen(port,'127.0.0.1',()=>probe.close(ok));});
  const {runtime:configure}=await import('../src/runtime.ts');runtime=await configure(env);
  const listen=async(server,port)=>{servers.push(server);await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});};
  const api=createServer(runtime.app);await listen(api,c.apiPort);
  await listen(mediaDemoServer({allowedOrigins:[`http://127.0.0.1:${c.webPort}`,`http://localhost:${c.webPort}`]}),c.mediaPort);
  await listen(staticBundle(resolve(c.bundle)),c.webPort);
  const ready=await fetch(`http://127.0.0.1:${c.apiPort}/health/ready`,{signal:AbortSignal.timeout(15000)});assert.equal(ready.status,200);
  const nonce=randomBytes(24).toString('hex'),pipe=process.platform==='win32'?`\\\\.\\pipe\\xland-p3-${nonce}`:resolve('.local',`p3-${nonce}.sock`);
  const state={pid:process.pid,pipe,nonce,instance:c.instance,apiBase:`http://127.0.0.1:${c.apiPort}/api/v1`,web:`http://127.0.0.1:${c.webPort}`,media:`http://127.0.0.1:${c.mediaPort}`,sourceHash:c.sourceHash,bundleHash:c.bundleHash,backendSourceHash,environment:target.environment,fingerprint:target.fingerprint,startedAt:new Date().toISOString()};
  controlServer=net.createServer(socket=>{let data='';socket.setTimeout(3000,()=>socket.destroy());socket.on('error',()=>{});socket.on('data',b=>{data+=b;if(data.length>1024){socket.destroy();return;}if(!data.includes('\n'))return;try{const m=JSON.parse(data);if(m.nonce!==nonce||!['status','stop'].includes(m.action)){socket.destroy();return;}const publicState=Object.fromEntries(Object.entries(state).filter(([key])=>!["nonce","pipe"].includes(key)));socket.end(JSON.stringify({...publicState,status:'ready'})+'\n');if(m.action==='stop')void stop(0);}catch{socket.destroy();}});});
  await new Promise((ok,fail)=>{controlServer.once('error',fail);controlServer.listen(pipe,ok);});
  await writeFile(statePath,JSON.stringify(state),{mode:0o600});await writeFile(resolve(c.evidence,'runtime-source.json'),JSON.stringify({backendSourceHash,files:backend},null,2));
  clearTimeout(watchdog);emit('p3_ready',{pid:state.pid,readiness:200,sourceHash:c.sourceHash,bundleHash:c.bundleHash,backendSourceHash});
 }catch(e){clearTimeout(watchdog);emit('p3_start_failed',{code:['EADDRINUSE','EEXIST','ENOENT'].includes(e.code)?e.code:'CONFIG_SOURCE_OR_HEALTH_FAILED',action:'Inspect owned state and redacted log; no occupied service was killed'});await stop(1);}
}
async function main(){
 if(command==='--worker')return worker();
 if(!['start','status','stop'].includes(command)){emit('usage',{command:'node scripts/p3-preview.mjs start | status | stop'});process.exitCode=2;return;}
 if(command!=='start'){try{const s=JSON.parse(await readFile(statePath,'utf8'));emit('p3_'+command,await control(s,command));if(command==='stop'){for(let n=0;n<40;n++){try{await readFile(lockPath);await delay(500);}catch{return;}}throw Error('STOP_TIMEOUT');}}catch{emit('p3_control_failed',{action:'Inspect owned state/PID; no service was killed'});process.exitCode=1;}return;}
 // Refuse a duplicate before spawning, including stale state: explicit inspection required.
 try{await readFile(lockPath);emit('p3_start_refused',{code:'EEXIST',action:'Use status; inspect stale lock without killing by port'});process.exitCode=1;return;}catch(e){if(e.code!=='ENOENT')throw e;}
 await mkdir('.local',{recursive:true});const log=await open('.local/p3-preview.log','a');
 const child=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),'--worker'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});child.unref();await log.close();
 for(let n=0;n<95;n++){try{const state=JSON.parse(await readFile(statePath,'utf8'));if(state.pid===child.pid){emit('p3_start',await control(state,'status'));return;}}catch{/* this worker only */}try{process.kill(child.pid,0);}catch{emit('p3_start_failed',{action:'See redacted .local/p3-preview.log'});process.exitCode=1;return;}await delay(1000);}
 emit('p3_start_failed',{code:'STARTUP_TIMEOUT',action:'Inspect owned status/log; watchdog cleans this worker'});process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main().catch(()=>{emit('p3_command_failed');process.exitCode=1;});
