import {readFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {runtime} from '../src/runtime.js';
const env={...parse(await readFile('.env.supabase-mock','utf8')),NODE_ENV:'development'};
const configured=await runtime(env);
const server=configured.app.listen(0,'127.0.0.1',()=>{
 const address=server.address();
 if(address&&typeof address!=='string')process.send?.({ready:true,port:address.port});
});
let stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;server.closeIdleConnections();await new Promise<void>(r=>server.close(()=>r()));await configured.close();process.disconnect?.();process.exit(0);};
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
process.on('message',message=>{if((message as {action?:string}).action==='stop')void stop();});
process.once('disconnect',()=>void stop());
