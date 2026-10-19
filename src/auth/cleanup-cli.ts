import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { databaseTarget } from '../config/database-target.js';
import { runAuthRetention } from './retention.js';

export function parseAuthCleanupArgs(args:readonly string[]):{apply:boolean;batchSize:number} {
  let apply=false,batchSize=200,modeSeen=false,limitSeen=false;
  for(const arg of args) {
    if(arg==='--apply'||arg==='--dry-run') {
      if(modeSeen)throw new Error('Choose one cleanup mode');
      modeSeen=true;apply=arg==='--apply';
    } else if(/^--limit=\d+$/.test(arg)) {
      if(limitSeen)throw new Error('Choose one cleanup batch limit');
      limitSeen=true;batchSize=Number(arg.slice('--limit='.length));
    } else throw new Error('Unknown auth cleanup argument');
  }
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>500)throw new Error('Cleanup limit must be 1..500');
  return {apply,batchSize};
}

export async function authCleanupMain(args:readonly string[],env:NodeJS.ProcessEnv):Promise<void> {
  const options=parseAuthCleanupArgs(args);
  const target=databaseTarget(env,false);
  if(options.apply&&env.AUTH_RETENTION_APPROVED_FINGERPRINT!==target.fingerprint)throw new Error('Auth retention apply target must be explicitly approved');
  const pool=new pg.Pool({connectionString:target.connectionString,max:1,connectionTimeoutMillis:5000,query_timeout:10000,
    application_name:'xland-auth-retention'});
  try {
    const result=await runAuthRetention(pool,options);
    console.log(JSON.stringify({event:'auth_retention',targetFingerprint:target.fingerprint,...result}));
  } finally {await pool.end();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  authCleanupMain(process.argv.slice(2),process.env).catch((error:unknown)=>{
    const code=(error as {code?:unknown})?.code;
    console.error(JSON.stringify({event:'auth_retention_failed',code:typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?code:'CONFIG_OR_DATABASE_ERROR'}));
    process.exitCode=1;
  });
}
