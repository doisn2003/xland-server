import {readdir,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {localPostgres} from './local-postgres.mjs';
import {runLocalChild} from './run-local-child.mjs';
const kind=process.argv[2];
if(!['integration','contract','scenarios'].includes(kind))throw new Error('Choose integration, contract or scenarios');
process.env.XLAND_EVIDENCE_DIR??=resolve('.local/evidence',new Date().toISOString().replace(/[:.]/g,'-')+'-'+kind);
if(!['.local/evidence','../brain/logs/agent-c/evidence'].some(root=>{const suffix=relative(resolve(root),resolve(process.env.XLAND_EVIDENCE_DIR));return !suffix.startsWith('..')&&!isAbsolute(suffix);}))throw new Error('Evidence must stay in the local QA or legacy Agent C namespace');
await mkdir(process.env.XLAND_EVIDENCE_DIR,{recursive:true});
let active,local;
const run=async args=>{const running=runLocalChild(args);active=running.child;try{await running.done;}finally{active=undefined;}};
const interrupted=()=>{active?.kill();void local?.stop().finally(()=>process.exit(130));};process.once('SIGINT',interrupted);process.once('SIGTERM',interrupted);
try{
 // Never consult shared DATABASE_URL. Recovery readiness completes before creating any test DB.
 local=await localPostgres();
 const files=kind==='scenarios'?['w3-scenarios.ts']:(await readdir(`tests/${kind}`)).filter(n=>n.endsWith('.test.ts')).sort();
 if(!files.length)throw new Error('No real PostgreSQL tests found');
 for(const file of files){process.env.XLAND_EVIDENCE_CASE=file;await run(['--import','tsx','scripts/verify-postgres-foundation.ts']);await run(kind==='scenarios'?['--import','tsx','scripts/w3-scenarios.ts']:['--import','tsx','--test',`tests/${kind}/${file}`]);}
}catch(e){console.error(JSON.stringify({event:'local_test_failed',reason:e.message?.startsWith('LOCAL_')?e.message:'Local runner failed; inspect per-run logs, private cluster preserved'}));process.exitCode=1;}
finally{await local?.stop();}
// embedded-postgres registers async-exit-hook beforeExit(0), which otherwise masks exitCode.
process.exit(process.exitCode??0);

