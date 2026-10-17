import {localPostgres} from './local-postgres.mjs';import net from 'node:net';import {writeFile,readFile} from 'node:fs/promises';import {randomBytes} from 'node:crypto';import {resolve} from 'node:path';import assert from 'node:assert/strict';
const run=JSON.parse(await readFile('.local/w3-run.json','utf8'));const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const directory=resolve('.local/w3-cold-'+randomBytes(5).toString('hex'));
let cold,warm,restarted;const steps=[];
try{let now=Date.now();cold=await localPostgres({directory,port});assert.equal(cold.wasStarted,true);steps.push({phase:'cold',wasStarted:true,ms:Date.now()-now});
now=Date.now();warm=await localPostgres({directory,port});assert.equal(warm.wasStarted,false);await warm.stop();steps.push({phase:'warm',wasStarted:false,ms:Date.now()-now,cleanup:'did not stop borrowed cluster'});
await cold.stop();now=Date.now();restarted=await localPostgres({directory,port});assert.equal(restarted.wasStarted,true);steps.push({phase:'restart-after-graceful-stop',wasStarted:true,ms:Date.now()-now});await restarted.stop();
await writeFile(resolve(run.evidence,'local-cold-warm.json'),JSON.stringify({timestamp:new Date().toISOString(),environment:'separate-local-cluster',port,steps,noReset:true,recoveryCrashNotInduced:true},null,2));console.log(JSON.stringify({event:'cold_warm_pass',steps}));
}finally{await restarted?.stop();await cold?.stop();}
process.exit(0);
