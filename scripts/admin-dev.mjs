import {readFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {runtime} from '../src/runtime.ts';
let env={...process.env};
for(const path of ['.env.supabase-mock','.env.auth','.env.geoapify','.env.p3-enrichment']){
  try{env={...env,...parse(await readFile(path,'utf8'))};}catch(e){if(e.code!=='ENOENT')throw e;}
}
const port=Number(process.argv[2]??3005);
const configured=await runtime({...env,NODE_ENV:'development'});
const server=configured.app.listen(port,'127.0.0.1',()=>console.log(`Admin API: http://127.0.0.1:${port}/api/v1/admin`));
const stop=()=>server.close(()=>void configured.close());
process.once('SIGINT',stop);process.once('SIGTERM',stop);
