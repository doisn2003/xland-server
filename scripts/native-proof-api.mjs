import {writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {localPostgres} from './local-postgres.mjs';
import {runLocalChild} from './run-local-child.mjs';
process.env.XLAND_EVIDENCE_CASE='native-proof';
const local=await localPostgres();let api;let closing=false;
const stop=async(code=0)=>{if(closing)return;closing=true;await api?.close();await local.stop();process.exit(code);};
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
try{
 await runLocalChild(['--import','tsx','scripts/verify-postgres-foundation.ts']).done;
 const {testApi}=await import('../tests/helpers/api.ts');api=await testApi();
 const address=new URL(api.base);const input={mode:'login',apiBaseUrl:'http://10.0.2.2:'+address.port+'/api/v1',username:api.context.first.username,password:api.context.first.password};
 await writeFile('.local/native-auth-input.json',JSON.stringify(input),{mode:0o600});
 await writeFile('.local/native-proof-runtime.json',JSON.stringify({pid:process.pid,port:Number(address.port),environment:'isolated-local-test',apiBaseUrl:input.apiBaseUrl}),{mode:0o600});
 console.log(JSON.stringify({event:'native_test_api_ready',port:Number(address.port),input:'private .local/native-auth-input.json',environment:'isolated-local-test'}));
 const lines=createInterface({input:process.stdin});lines.on('line',line=>{void(async()=>{
  const {action}=JSON.parse(line);if(action==='stop'){await stop();return;}
  if(!['expire','revoke'].includes(action))throw Error('Unsupported private probe action');
  const query=action==='expire'?"UPDATE xland.auth_sessions SET created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()":"UPDATE xland.auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()";
  const changed=await api.db.pool.query(query,[api.context.first.id]);
  console.log(JSON.stringify({event:'native_test_session_'+action,rows:changed.rowCount,environment:'isolated-local-test'}));
 })().catch(()=>console.error('Redacted native probe control failed'));});
 lines.once('close',()=>void stop());
}catch{console.error('Redacted native local API startup failed');await stop(1);}
// No shared env/database is consulted. The only mutable DB is a fresh local test.
