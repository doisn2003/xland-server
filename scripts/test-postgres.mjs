import { spawn } from 'node:child_process';
import { readdir,mkdir } from 'node:fs/promises';
import {resolve}from'node:path';
import { localPostgres } from './local-postgres.mjs';

const kind=process.argv[2];
if(!['integration','contract'].includes(kind))throw new Error('Choose integration or contract');
process.env.XLAND_EVIDENCE_DIR??=resolve('../brain/logs/agent-c/evidence/P2/runs',new Date().toISOString().replace(/[:.]/g,'-')+'-'+kind);
await mkdir(process.env.XLAND_EVIDENCE_DIR,{recursive:true});
const run=(args)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Test subprocess failed: exit ${code}`)));
});
// Never consult the shared DATABASE_URL: each file receives a newly created local test DB.
const local=await localPostgres();
try {
  const files=(await readdir(`tests/${kind}`)).filter(n=>n.endsWith('.test.ts')).sort();
  if(!files.length)throw new Error('No real PostgreSQL tests found');
  for(const file of files){
    process.env.XLAND_EVIDENCE_CASE=file;
    await run(['--import','tsx','scripts/verify-postgres-foundation.ts']);
    await run(['--import','tsx','--test',`tests/${kind}/${file}`]);
  }
}finally{await local.stop();}
