import {readFile,writeFile} from 'node:fs/promises';
import {Database} from '../src/repositories/database.js';
import {databaseTarget} from '../src/config/database-target.js';
import {evidenceDirectory} from '../src/config/evidence.js';
const context=JSON.parse(await readFile('.local/test-context.json','utf8')) as {connectionString:string;first:{id:string}};
const target=databaseTarget({TEST_DATABASE_URL:context.connectionString,TEST_DATABASE_ENVIRONMENT:'test'},true);
const db=new Database(target.connectionString,1);
const cycles=Number(process.argv[2]??'1');
if(!Number.isSafeInteger(cycles)||cycles<1||cycles>3)throw Error('Choose one to three isolated native proof cycles');
try{
 const state=(await db.pool.query(`SELECT count(*)::int total,
 count(*) FILTER(WHERE revoked_at IS NULL AND expires_at<=now())::int expired,
 count(*) FILTER(WHERE revoked_at IS NOT NULL)::int revoked,
 count(*) FILTER(WHERE revoked_at IS NULL AND expires_at>now())::int active,
 bool_and(expires_at-created_at=interval '24 hours') policy_24h_preserved
 FROM xland.auth_sessions WHERE user_id=$1`,[context.first.id])).rows[0];
 if(state.expired!==cycles||state.revoked!==2*cycles||state.active!==0||!state.policy_24h_preserved)throw Error('Native local session lifecycle mismatch');
 await writeFile((await evidenceDirectory())+'/native-session-database-audit-'+cycles+'-'+Date.now()+'.json',JSON.stringify({timestamp:new Date().toISOString(),environment:'isolated-local-test',cycles,state,source:'native login/restart/logout and actual local expire/revoke controls; no Supabase mutation',tokenOrCredentialLogged:false},null,2));
 console.log(JSON.stringify({event:'native_local_session_audit',...state}));
}catch{console.error('Redacted native local session audit failed');process.exitCode=1;}finally{await db.close();}
