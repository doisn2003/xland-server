import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pg_ctl = process.platform === 'win32' ? (await import('@embedded-postgres/windows-x64')).pg_ctl : undefined;
const execute = promisify(execFile);
const pause=ms=>new Promise(r=>setTimeout(r,ms));

export async function waitForLocalReady(probe,{timeoutMs=90000,intervalMs=500}={}){
  const until=Date.now()+timeoutMs;let attempts=0;
  while(Date.now()<until){attempts++;try{await probe();return {attempts};}catch(e){
    if(['28P01','28000'].includes(e.code))throw new Error('Local cluster authentication failed; private credentials preserved');
    await pause(Math.min(intervalMs,Math.max(0,until-Date.now())));
  }}
  throw new Error('LOCAL_POSTGRES_READY_TIMEOUT; preserve cluster and inspect private postgres.log');
}
export async function localPostgres({directory=resolve('.local'),port=55439}={}) {
  const dir = resolve(directory);await mkdir(dir, { recursive: true });let config;
  try { config = JSON.parse(await readFile(resolve(dir,'cluster.json'),'utf8')); }
  catch(error) { if(error.code!=='ENOENT')throw new Error('Existing local cluster config is unreadable; preserve it for review');config = { port, password: randomBytes(32).toString('base64url') }; await writeFile(resolve(dir,'cluster.json'),JSON.stringify(config),{mode:0o600}); }
  const postgres = new EmbeddedPostgres({ databaseDir: resolve(dir,'postgres'), user:'postgres', password:config.password,
    port:config.port, persistent:true, authMethod:'scram-sha-256',
    postgresFlags:['-h','127.0.0.1'], initdbFlags:['--encoding=UTF8','--locale=C'], onLog:()=>{}, onError:()=>{} });
  let wasStarted=false;const rootUrl=`postgresql://postgres:${config.password}@127.0.0.1:${config.port}/postgres`;
  const probe=async()=>{const client=new pg.Client({connectionString:rootUrl,connectionTimeoutMillis:1000,query_timeout:1000});try{await client.connect();await client.query('SELECT 1');}finally{await client.end().catch(()=>{});}};
  const stop=async()=>{if(wasStarted){if(process.platform==='win32')await execute(pg_ctl,['-D',resolve(dir,'postgres'),'-m','fast','-t','15','-w','stop'],{windowsHide:true,timeout:20000});else await postgres.stop();wasStarted=false;}};
  try{await probe();}
  catch(error){
    if(['28P01','28000'].includes(error.code))throw new Error('Local cluster authentication failed; existing private credentials preserved');
    let existing=false;try{await readFile(resolve(dir,'postgres','PG_VERSION'));existing=true;}catch(e){if(e.code!=='ENOENT')throw new Error('Local cluster metadata unreadable');}
    if(!existing)await postgres.initialise();
    let running=false;
    if(process.platform==='win32'){try{await execute(pg_ctl,['-D',resolve(dir,'postgres'),'status'],{windowsHide:true,timeout:5000});running=true;}catch(e){if(e.code!==3)throw new Error('Local cluster status failed; preserve cluster for inspection');}}
    if(!running){
      if(process.platform==='win32')await execute(pg_ctl,['-D',resolve(dir,'postgres'),'-l',resolve(dir,'postgres.log'),'-o',`-p ${config.port} -h 127.0.0.1`,'-t','60','-W','start'],{windowsHide:true,timeout:10000});
      else await postgres.start();
      wasStarted=true;
    }
    try{await waitForLocalReady(probe);}catch(e){await stop().catch(()=>{});throw e;}
  }
  return {rootUrl,config,postgres,wasStarted,stop};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve('scripts/local-postgres.mjs')){
 const local=await localPostgres();console.log(JSON.stringify({status:'running',host:'127.0.0.1',port:local.config.port,environment:'isolated-local-postgresql',credentials:'private .local/cluster.json'}));
 const close=async()=>{await local.stop();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);setInterval(()=>{},1000);
}
