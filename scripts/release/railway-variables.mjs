// Provision only the intended XLand service. Values go through stdin, never logs/arguments.
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
const service='22e32363-d4d9-4f4a-80b9-cebaab3a3891';
const environment='1948710d-9ce9-4387-aef9-6bb67daf1c60';
const project='b111bc9d-7eb1-496c-b70d-204f6a6c42f2';
const cli=process.env.XLAND_RAILWAY_CLI;
if(!cli)throw new Error('Set XLAND_RAILWAY_CLI to the installed official CLI executable');
const values=JSON.parse(await readFile('.local/release/railway-variables.json','utf8'));
const allowed=new Set(['NODE_ENV','PORT','BIND_HOST','DATABASE_URL','DATABASE_ENVIRONMENT','DATABASE_APPROVED_FINGERPRINT','CURSOR_SECRET',
  'XLAND_API_MODE','XLAND_GOOGLE_LOGIN_ENABLED','GOOGLE_AUTH_AUDIENCES','XLAND_PHONE_OTP_ENABLED','SMS_BRANDNAME_APPROVED','MAPS_EMBED_ENABLED',
  'MAPS_GEOAPIFY_ENABLED','MAPS_GEOAPIFY_API_KEY','MAPS_GEOAPIFY_DAILY_CREDITS','CORS_ORIGINS','TRUST_PROXY_HOPS','XLAND_RELEASE_VERSION']);
if(Object.keys(values).some(k=>!allowed.has(k)))throw new Error('Unapproved Railway variable');
const installed=[];
const defaults=[];
for(const [key,value] of Object.entries(values)) {
  if(typeof value!=='string')throw new Error('Invalid variable type');
  // A fresh service uses the application's empty CORS default. CLI stdin rejects empty values.
  if(key==='CORS_ORIGINS' && value===''){defaults.push(key);continue;}
  const result=await new Promise((done,reject)=>{
    const child=spawn(cli,['variable','set',key,'--stdin','--skip-deploys','--project',project,'--service',service,'--environment',environment,'--json'],
      {windowsHide:true,stdio:['pipe','pipe','pipe']});
    // CLI may echo variable values; discard both output streams.
    child.stdout.resume();child.stderr.resume();child.once('error',reject);child.once('exit',done);child.stdin.end(value);
  });
  if(result!==0)throw new Error(`Railway variable failed: ${key} (details suppressed)`);
  installed.push(key);console.log(JSON.stringify({set:key}));
}
await writeFile('../brain/logs/agent-a/A21_PHASE4_2026-10-19/railway-variable-names.json',JSON.stringify({project,service,environment,installed,defaults,time:new Date().toISOString()},null,2));
