import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { Database } from '../../src/repositories/database.js';
import { AuthService } from '../../src/services/auth.js';
import { CursorCodec } from '../../src/services/cursor.js';
import { CoreService } from '../../src/services/core.js';
import { createApp } from '../../src/app.js';
import { apiRouter } from '../../src/routes/v1/api.js';
import { databaseTarget } from '../../src/config/database-target.js';
import type { Wire } from '../../src/repositories/properties.js';

export async function testApi() {
  const context=JSON.parse(await readFile('.local/test-context.json','utf8')) as {connectionString:string;first:{id:string;username:string;password:string};second:{id:string;username:string;password:string}};
  const target=databaseTarget({TEST_DATABASE_URL:context.connectionString,TEST_DATABASE_ENVIRONMENT:'test'},true);
  const db=new Database(target.connectionString,8);const auth=new AuthService(db);await auth.initialize();
  const service=new CoreService(db,auth,new CursorCodec(randomBytes(32)),()=>new Date(),'https://xland.example.test/');
  const server=createApp({checkReadiness:()=>db.ready(),api:apiRouter(service),allowedOrigins:['http://localhost:5555']}).listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test listener');
  const base=`http://127.0.0.1:${address.port}/api/v1`;
  const request=async(path:string,method='GET',body?:unknown,token?:string,key?:string)=>{
    const res=await fetch(base+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:res.status,body:await res.json() as Wire,headers:res.headers};
  };
  const login=async(account=context.first)=>{
    const result=await request('/auth/sessions','POST',{username:account.username,password:account.password});
    if(result.status!==200)throw new Error('Private test account login failed');
    return (result.body.data as {accessToken:string}).accessToken;
  };
  return {context,db,service,request,login,base,close:async()=>{server.close();await once(server,'close');await db.close();}};
}
