// Foreground development server for A-19. Keeps the frozen report instance intact.
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {parse} from 'dotenv';
import {runtime} from '../src/runtime.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const allowedAuth=new Set(['XLAND_GOOGLE_LOGIN_ENABLED','GOOGLE_AUTH_AUDIENCES','XLAND_PHONE_OTP_ENABLED',
  'XLAND_SMS_PROVIDER','SMS_BRANDNAME_APPROVED','SMS_BRANDNAME','SMS_OTP_TEMPLATE','ESMS_API_KEY','ESMS_SECRET_KEY','OTP_HMAC_KEY',
  'AUTH_RETENTION_APPROVED_FINGERPRINT']);
async function overlay(file,allowed) {
  let text;
  try{text=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return {};throw error;}
  const values=parse(text);
  if(Object.keys(values).some(key=>!allowed(key)))throw new Error('Private overlay contains unexpected configuration keys');
  return values;
}
const argument=process.argv[2]??'3004';
let configured,server,stopping=false;
async function close() {
  if(stopping)return;stopping=true;
  if(server?.listening)await new Promise(done=>{server.closeIdleConnections();server.close(done);});
  await configured?.close();
}
try{
  if(!/^\d+$/.test(argument)||Number(argument)<1024||Number(argument)>65535)throw new Error('Port must be 1024..65535');
  const base=parse(await readFile('.env.supabase-mock','utf8'));
  const auth=await overlay('.env.auth',key=>allowedAuth.has(key));
  const maps=await overlay('.env.maps',key=>key.startsWith('MAPS_'));
  const geoapify=await overlay('.env.geoapify',key=>key.startsWith('MAPS_GEOAPIFY_'));
  const env={...base,...auth,...maps,...geoapify,NODE_ENV:'development',BIND_HOST:'127.0.0.1',PORT:argument,
    CORS_ORIGINS:'http://127.0.0.1:5557,http://localhost:5557,http://127.0.0.1:5559,http://localhost:5559'};
  configured=await runtime(env);
  server=createServer(configured.app);
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(Number(argument),'127.0.0.1',done);});
  const check=await fetch(`http://127.0.0.1:${argument}/health/ready`,{signal:AbortSignal.timeout(15000)});
  if(check.status!==200)throw new Error('Database readiness failed');
  console.log(JSON.stringify({event:'a19_ready',api:`http://127.0.0.1:${argument}/api/v1`,
    emulatorApi:`http://10.0.2.2:${argument}/api/v1`,configFiles:['.env.supabase-mock','.env.auth','.env.geoapify'],
    note:'Provider readiness is reported by capabilities. No migration/seed/SMS occurs at startup.'}));
  process.once('SIGINT',()=>void close());
  process.once('SIGTERM',()=>void close());
}catch(error){
  console.error(JSON.stringify({event:'a19_start_failed',code:['EADDRINUSE','ENOENT'].includes(error.code)?error.code:'CONFIG_OR_READINESS_FAILED',
    action:'Check private configuration and port; no occupied process was stopped.'}));
  await close();process.exitCode=1;
}
