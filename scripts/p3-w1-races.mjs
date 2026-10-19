// Narrow W1 race/snapshot regressions. Each suite gets a fresh LOCAL test DB.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {localPostgres} from './local-postgres.mjs';
import {runLocalChild} from './run-local-child.mjs';
const c=JSON.parse(await readFile('.local/p3-context.json','utf8'));let local,phase='local-readiness';const exits=[];
process.env.XLAND_EVIDENCE_DIR=resolve(c.evidence,'local-races');
try{
 local=await localPostgres();
 for(const file of ['modules.test.ts','finance.test.ts']){
  phase=file;process.env.XLAND_EVIDENCE_CASE='w1-race-'+file;
  await runLocalChild(['--import','tsx','scripts/verify-postgres-foundation.ts']).done;
  await runLocalChild(['--import','tsx','--test','tests/integration/'+file]).done;
  exits.push({file,exit:0});
 }
}catch{exits.push({phase,exit:1});console.error('W1 local race regression failed; details redacted, preserve isolated DB/evidence');process.exitCode=1;}finally{await local?.stop();}
await writeFile(resolve(c.evidence,'local-races-exits.json'),JSON.stringify({scope:'fresh isolated local DB per file; never Supabase',backendSourceHash:'a420f50fa5195d29fbd862ba46d30cdf83c203313eedb90eb06d5b1fe600c16d',exits},null,2));
process.exit(process.exitCode??0);
