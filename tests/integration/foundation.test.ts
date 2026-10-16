import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('PostgreSQL vertical slice: auth, filter/cursor, persisted saves, legal ACL and actual-role RLS',async t=>{
  const context=JSON.parse(await readFile('.local/test-context.json','utf8')) as {connectionString:string;first:{id:string;username:string;password:string};second:{id:string;username:string;password:string}};
  // Deliberately route through the same target guard used by CI/migration scripts.
  const target=databaseTarget({...process.env,TEST_DATABASE_URL:context.connectionString,TEST_DATABASE_ENVIRONMENT:'test'},true);
  const db=new Database(target.connectionString,3);
  const auth=new AuthService(db,()=>new Date(),5);await auth.initialize();
  const service=new CoreService(db,auth,new CursorCodec(randomBytes(32)));
  const server=createApp({checkReadiness:()=>db.ready(),api:apiRouter(service)}).listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}/api/v1`;
  const request=async(path:string,method='GET',body?:unknown,token?:string)=>{
    const res=await fetch(base+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:res.status,body:await res.json() as Record<string,unknown>};
  };
  try {
    const fixture=JSON.parse(await readFile('../brain/logs/agent-c/fixtures/v0.1.json','utf8')) as {properties:Array<{id:string}>;documents:Array<{id:string}>};
    const property=fixture.properties[0]!.id;
    let firstToken='';let secondToken='';
    await t.test('guest public reads, exact money, no private columns and validation',async()=>{
      const response=await request('/properties');assert.equal(response.status,200);
      const data=response.body.data as Array<Record<string,unknown>>;assert.equal(data.length,4);assert.equal(typeof data[0]!.priceTotal,'string');
      assert.ok(!JSON.stringify(data).includes('storage_key'));assert.ok(!JSON.stringify(data).includes('customer_phone'));
      const detail=await request('/properties/'+property);assert.equal(detail.status,200);assert.equal((detail.body.data as Record<string,unknown>).priceTotal,'2400000000');
      assert.equal((await request('/properties?limit=0')).status,400);
      assert.equal((await request('/properties?category=industrial')).status,200);
      assert.equal((await request('/properties?regions=industrial')).status,400);
      assert.equal((await request('/properties?minPriceVnd=3000000000&maxPriceVnd=1000000000')).status,400);
      assert.equal((await request('/properties/'+property+'/saved','PUT')).status,401);
      assert.equal((await request('/me/profile')).status,401);
      assert.equal((await request('/properties?savedOnly=true')).status,401);
    });
    await t.test('username normalization; wrong credentials; opaque token; private profile',async()=>{
      const bad=await request('/auth/sessions','POST',{username:context.first.username,password:'incorrect-value'});assert.equal(bad.status,401);
      const result=await request('/auth/sessions','POST',{username:' '+context.first.username.toUpperCase()+' ',password:context.first.password});assert.equal(result.status,200);
      const data=result.body.data as {accessToken:string;session:{profile:{id:string};expiresAt:string}};
      firstToken=data.accessToken;assert.match(firstToken,/^[A-Za-z0-9_-]{43}$/);assert.equal(data.session.profile.id,context.first.id);assert.ok(!('refreshToken' in data));
      const second=await request('/auth/sessions','POST',context.second);assert.equal(second.status,400,'unknown input id must be rejected');
      const secondResult=await request('/auth/sessions','POST',{username:context.second.username,password:context.second.password});assert.equal(secondResult.status,200);secondToken=(secondResult.body.data as {accessToken:string}).accessToken;
      assert.equal((await request('/me/profile','GET',undefined,firstToken)).status,200);
      assert.equal((await request('/me/profile?userId='+context.second.id,'GET',undefined,firstToken)).status,400,'unknown owner selector must be rejected');
    });
    await t.test('saved property persisted, retry idempotent and cross-user invisible',async()=>{
      assert.equal((await request('/properties/'+property+'/saved','PUT',undefined,firstToken)).status,200);
      assert.equal((await request('/properties/'+property+'/saved','PUT',undefined,firstToken)).status,200);
      const mine=await request('/properties?savedOnly=true','GET',undefined,firstToken);assert.equal((mine.body.data as unknown[]).length,1);
      const other=await request('/properties?savedOnly=true','GET',undefined,secondToken);assert.equal((other.body.data as unknown[]).length,0);
      assert.equal(Number((await db.pool.query('SELECT count(*) FROM xland.saved_properties WHERE user_id=$1',[context.first.id])).rows[0].count),1);
      await request('/properties/'+property+'/saved','PUT',undefined,secondToken);
    });
    await t.test('cursor tied to filters/user and page does not omit or duplicate IDs',async()=>{
      const seen:string[]=[];let cursor:string|null=null;
      do {
        const result=await request('/properties?sort=price_asc&limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(result.status,200);
        seen.push(...(result.body.data as Array<{id:string}>).map(p=>p.id));cursor=(result.body.meta as {nextCursor:string|null}).nextCursor;
        if(cursor){assert.equal((await request('/properties?sort=price_desc&limit=1&cursor='+encodeURIComponent(cursor))).status,400);}
      }while(cursor);
      assert.equal(seen.length,4);assert.equal(new Set(seen).size,4);
      const q='regions=north&provinceCode=01&minPriceVnd=1000000000&maxPriceVnd=3000000000&areaBands=from_100_to_200&landTypes=residential&minRoadWidthM=4&hasDocuments=true';
      const count=await request('/properties/count?'+q);assert.deepEqual(count.body.data,{total:1,selectedCriteriaCount:7});
    });
    await t.test('legal count, no storage key, grant permission and map fallback',async()=>{
      const legal=await request('/properties/'+property+'/legal');const data=legal.body.data as Record<string,unknown>;assert.equal(data.verifiedCount,4);assert.equal(data.totalCount,6);
      assert.equal((await request('/properties/'+property+'/documents/'+fixture.documents[0]!.id+'/download','POST')).status,401);
      assert.equal((await request('/properties/'+property+'/documents/'+fixture.documents[0]!.id+'/download','POST',undefined,firstToken)).status,403);
      assert.equal((await request('/properties/'+property+'/documents/'+fixture.documents[1]!.id+'/download','POST')).status,409);
      const area=await request('/properties/'+property+'/area');assert.equal(area.status,200);assert.equal((area.body.data as Record<string,unknown>).externalMapUrl,null);
      assert.ok(!JSON.stringify(area.body).includes('storage_key'));
    });
    await t.test('actual API role cannot bypass RLS/columns and pool context clears',async()=>{
      await db.transaction('xland_api',context.first.id,async c=>{
        const role=await c.query(`SELECT current_user,(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) bypass`);assert.equal(role.rows[0].current_user,'xland_api');assert.equal(role.rows[0].bypass,false);
        assert.equal((await c.query('SELECT user_id FROM xland.saved_properties WHERE user_id=$1',[context.second.id])).rowCount,0);
      });
      await assert.rejects(db.transaction('xland_api',null,c=>c.query('SELECT password_hash FROM xland.user_identities')));
      await assert.rejects(db.transaction('xland_api',null,c=>c.query('SELECT lat,lng FROM xland.properties')));
      await assert.rejects(db.transaction('xland_api',context.first.id,c=>c.query('INSERT INTO xland.saved_properties(user_id,property_id) VALUES($1,$2)',[context.second.id,fixture.properties[1]!.id])));
      await db.transaction('xland_api',context.first.id,async c=>{assert.equal((await c.query('DELETE FROM xland.saved_properties WHERE user_id=$1',[context.second.id])).rowCount,0);});
      assert.equal(Number((await db.pool.query('SELECT count(*) FROM xland.saved_properties WHERE user_id=$1',[context.second.id])).rows[0].count),1);
      await db.transaction('xland_api',null,async c=>{assert.equal((await c.query('SELECT * FROM xland.saved_properties')).rowCount,0);});
      const c=await db.pool.connect();try{assert.notEqual((await c.query('SELECT current_user')).rows[0].current_user,'xland_api');assert.ok(!(await c.query("SELECT current_setting('xland.user_id',true) value")).rows[0].value);}finally{c.release();}
    });
    await t.test('expiry, logout revocation and rate limit',async()=>{
      assert.equal((await request('/auth/sessions/current','DELETE',undefined,firstToken)).status,200);
      assert.equal((await request('/me/profile','GET',undefined,firstToken)).status,401);
      await db.pool.query("UPDATE xland.auth_sessions SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE user_id=$1",[context.second.id]);
      assert.equal((await request('/me/profile','GET',undefined,secondToken)).status,401);
      for(let i=0;i<6;i++)await request('/auth/sessions','POST',{username:'missing-name',password:'incorrect-value'});
      assert.equal((await request('/auth/sessions','POST',{username:'missing-name',password:'incorrect-value'})).status,429);
    });
  }finally{server.close();await once(server,'close');await db.close();}
});
