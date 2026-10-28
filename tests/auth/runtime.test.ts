import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import argon2 from 'argon2';
import {runtime} from '../../src/runtime.js';
import {Database} from '../../src/repositories/database.js';
import {runAuthRetention,authRetentionUsing} from '../../src/auth/retention.js';
import {parseAuthCleanupArgs,authCleanupMain} from '../../src/auth/cleanup-cli.js';
import {AuthService} from '../../src/services/auth.js';
import {CoreService} from '../../src/services/core.js';
import {CursorCodec} from '../../src/services/cursor.js';
import {ExtendedAuthService} from '../../src/auth/extended-auth.js';
import {PhoneOtpService} from '../../src/auth/phone-otp.js';
import {apiRouter} from '../../src/routes/v1/api.js';
import {createApp} from '../../src/app.js';

function isolatedConnection(name:'XLAND_LOGIN_TEST_DB'|'XLAND_LOGIN_BASELINE_TEST_DB'):string {
  const connection=process.env[name];
  if(!connection||new URL(connection).hostname!=='127.0.0.1'||!/^\/xland_test_login_[a-f0-9]{12}(_baseline)?$/.test(new URL(connection).pathname))throw new Error('Use isolated auth runner');
  return connection;
}

for(const key of ['XLAND_LOGIN_BASELINE_TEST_DB','XLAND_LOGIN_TEST_DB'] as const) {
  test(`actual runtime default-off with ${key==='XLAND_LOGIN_TEST_DB'?'current schema preserves session/private owner isolation':'pre0009 schema fails readiness until migration'}`,async()=>{
    const connection=isolatedConnection(key),db=new Database(connection);
    const password='a19_test_password',user=randomUUID(),other=randomUUID(),username='a19_'+randomBytes(5).toString('hex');
    const hash=await argon2.hash(password);
    await db.transaction('xland_auth',null,async c=>{
      for(const [id,name] of [[user,username],[other,username+'_other']]) {
        await c.query('INSERT INTO xland.user_identities(id,username_normalized,password_hash) VALUES($1,$2,$3)',[id,name,hash]);
        await c.query('INSERT INTO xland.user_profiles(id,display_name) VALUES($1,$2)',[id,name]);
        await c.query('INSERT INTO xland.user_contacts(user_id) VALUES($1)',[id]);
        await c.query('INSERT INTO xland.user_settings(user_id) VALUES($1)',[id]);
      }
    });
    const instance=await runtime({NODE_ENV:'test',TEST_DATABASE_URL:connection,TEST_DATABASE_ENVIRONMENT:'test',CURSOR_SECRET:randomBytes(32).toString('hex')});
    const server=instance.app.listen(0,'127.0.0.1');await once(server,'listening');
    const root=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post=(path:string,body:unknown,token='stale-bearer')=>fetch(root+'/api/v1'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'Idempotency-Key':randomUUID()},body:JSON.stringify(body)});
    try {
      const capability=await fetch(root+'/api/v1/auth/capabilities',{headers:{Authorization:'Bearer stale'}});
      assert.equal(capability.status,200);assert.equal(capability.headers.get('cache-control'),'no-store');
      const data=(await capability.json() as {data:{google:{enabled:boolean};phoneOtp:{enabled:boolean}}}).data;
      assert.equal(data.google.enabled,false);assert.equal(data.phoneOtp.enabled,false);
      for(const [path,body] of [['/auth/google/sessions',{idToken:'bad'}],['/auth/phone/challenges',{phone:'0981234567'}],['/auth/phone/sessions',{challengeId:randomUUID(),code:'123456'}]] as const) {
        const response=await post(path,body);assert.equal(response.status,503);
        assert.equal((await response.json() as {error:{code:string}}).error.code,'FEATURE_NOT_ENABLED');
      }
      assert.equal((await post('/auth/google/sessions',{idToken:'bad',userId:user})).status,400);
      if(key==='XLAND_LOGIN_BASELINE_TEST_DB') {
        // Current catalog/profile/session code requires later migrations. Never
        // accept this historical schema as deployable merely because auth is off.
        assert.equal((await fetch(root+'/health/ready')).status,503);
        assert.equal((await fetch(root+'/api/v1/me/profile')).status,401);
        return;
      }
      assert.equal((await fetch(root+'/health/ready')).status,200);
      assert.equal((await fetch(root+'/api/v1/catalog/locations')).status,200);
      assert.equal((await fetch(root+'/api/v1/me/profile')).status,401);
      const login=await post('/auth/sessions',{username,password});assert.equal(login.status,200);
      const logged=(await login.json() as {data:{accessToken:string;session:{profile:{id:string}}}}).data;
      assert.equal(logged.session.profile.id,user);
      const headers={Authorization:'Bearer '+logged.accessToken,'Content-Type':'application/json'};
      assert.equal((await fetch(root+'/api/v1/auth/session',{headers})).status,200);
      assert.equal((await fetch(root+'/api/v1/me/profile',{method:'PATCH',headers,body:JSON.stringify({displayName:'A19 owner update'})})).status,200);
      const otherProfile=await db.transaction('xland_auth',null,c=>c.query<{display_name:string}>('SELECT display_name FROM xland.user_profiles WHERE id=$1',[other]));
      assert.notEqual(otherProfile.rows[0]!.display_name,'A19 owner update');
      assert.equal((await fetch(root+'/api/v1/auth/sessions/current',{method:'DELETE',headers})).status,200);
      assert.equal((await fetch(root+'/api/v1/auth/session',{headers})).status,401);
    } finally {server.close();await once(server,'close');await instance.close();await db.close();}
  });
}

test('retention defaults dry-run; preserves recent replay digests, active 30-day budgets, identities and sessions; bounded apply is repeatable',async()=>{
  const db=new Database(isolatedConnection('XLAND_LOGIN_TEST_DB'));
  const now=new Date('2026-12-01T00:00:00Z');
  const oldCreated=new Date(now.getTime()-3*86400000),oldExpiry=new Date(oldCreated.getTime()+300000);
  const recentExpiry=new Date(now.getTime()-60000),recentCreated=new Date(recentExpiry.getTime()-300000);
  const oldIds=[randomUUID(),randomUUID(),randomUUID()],recentId=randomUUID();
  try {
    // Use fixtures clearly outside the clock/namespace of the OTP send tests.
    for(const [id,created,expiry] of [...oldIds.map(id=>[id,oldCreated,oldExpiry] as const),[recentId,recentCreated,recentExpiry] as const]) {
      await db.pool.query(`INSERT INTO xland.auth_otp_challenges(id,phone,phone_hash,request_digest,code_digest,created_at,expires_at,resend_at,status)
        VALUES($1,'+84990000001',$2,$3,$4,$5,$6,$7,'uncertain')`,[id,randomBytes(32),randomBytes(32),randomBytes(32),created,expiry,new Date(created.getTime()+60000)]);
    }
    const rateOld=randomBytes(32),rateActive=randomBytes(32);
    await db.pool.query('INSERT INTO xland.auth_rate_buckets(bucket_key,hits,expires_at) VALUES($1,5,$2),($3,150,$4)',[rateOld,oldExpiry,rateActive,new Date(now.getTime()+86400000)]);
    const preservedUser=randomUUID();
    await db.transaction('xland_auth',null,async c=>{
      await c.query('INSERT INTO xland.user_identities(id,username_normalized,password_hash) VALUES($1,NULL,NULL)',[preservedUser]);
      await c.query("INSERT INTO xland.auth_external_identities(issuer,subject,user_id) VALUES('https://accounts.google.com',$1,$2)",[randomUUID(),preservedUser]);
      await c.query('INSERT INTO xland.auth_sessions(id,user_id,token_digest,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[randomUUID(),preservedUser,randomBytes(32),now,new Date(now.getTime()+86400000)]);
    });
    const preview=await runAuthRetention(db.pool,{now,batchSize:2});assert.equal(preview.apply,false);assert.equal(preview.challenges.deleted,0);assert.equal(preview.challenges.moreEligible,true);
    await assert.rejects(db.transaction('xland_api',null,c=>authRetentionUsing(c,{apply:true,now})),e=>(e as {code:string}).code==='42501');
    await assert.rejects(db.transaction('xland_auth',null,c=>authRetentionUsing(c,{apply:true,now})),e=>(e as {code:string}).code==='42501');
    const first=await runAuthRetention(db.pool,{apply:true,batchSize:2,now});assert.equal(first.challenges.deleted,2);assert.ok(first.rateBuckets.deleted<=2);
    // Drain bounded batches for test fixtures/old expired rows only.
    for(let i=0;i<20;i++) {const batch=await runAuthRetention(db.pool,{apply:true,batchSize:500,now});if(batch.challenges.deleted===0&&batch.rateBuckets.deleted===0)break;}
    const final=await runAuthRetention(db.pool,{apply:true,batchSize:500,now});assert.equal(final.challenges.deleted,0);assert.equal(final.rateBuckets.deleted,0);
    assert.equal((await db.pool.query('SELECT id FROM xland.auth_otp_challenges WHERE id=$1',[recentId])).rowCount,1);
    assert.equal((await db.pool.query('SELECT hits FROM xland.auth_rate_buckets WHERE bucket_key=$1',[rateActive])).rows[0].hits,150);
    assert.equal((await db.pool.query('SELECT user_id FROM xland.auth_external_identities WHERE user_id=$1',[preservedUser])).rowCount,1);
    assert.equal((await db.pool.query('SELECT user_id FROM xland.auth_sessions WHERE user_id=$1',[preservedUser])).rowCount,1);
  } finally {await db.close();}
});

test('cleanup CLI parser and explicit apply fingerprint reject unsafe invocation before connecting',async()=>{
  assert.deepEqual(parseAuthCleanupArgs([]),{apply:false,batchSize:200});
  assert.deepEqual(parseAuthCleanupArgs(['--apply','--limit=5']),{apply:true,batchSize:5});
  for(const args of [['--limit=0'],['--limit=501'],['--apply','--dry-run'],['--limit=5','--limit=10'],['--force']])assert.throws(()=>parseAuthCleanupArgs(args));
  const target='postgresql://test:test@127.0.0.1:1/xland_development_auth';
  const fingerprint=createHash('sha256').update('127.0.0.1/xland_development_auth').digest('hex').slice(0,16);
  await assert.rejects(authCleanupMain(['--apply'],{DATABASE_URL:target,DATABASE_ENVIRONMENT:'development',DATABASE_APPROVED_FINGERPRINT:fingerprint}),/explicitly approved/);
});

test('mounted full API routes exchange verified Google/OTP into the same owner-scoped session and independent logout',async()=>{
  const db=new Database(isolatedConnection('XLAND_LOGIN_TEST_DB')),auth=new AuthService(db);await auth.initialize();
  let testCode='';
  const phone=new PhoneOtpService(db,auth,{send:async input=>{testCode=input.code;}},randomBytes(32));
  const extension=new ExtendedAuthService(db,auth,{verify:async idToken=>{
    assert.equal(idToken,'test-only-proof');return {issuer:'https://accounts.google.com',subject:'a19-http-'+randomUUID()};
  }},phone);
  const core=new CoreService(db,auth,new CursorCodec(randomBytes(32)));
  const server=createApp({checkReadiness:()=>db.ready(),api:apiRouter(core,[],extension)}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const root=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const post=(path:string,body:unknown)=>fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer old-invalid-session','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});
  try {
    const capabilities=(await (await fetch(root+'/auth/capabilities')).json() as {data:{google:{enabled:boolean};phoneOtp:{enabled:boolean}}}).data;
    assert.equal(capabilities.google.enabled,true);assert.equal(capabilities.phoneOtp.enabled,true);
    const googleResponse=await post('/auth/google/sessions',{idToken:'test-only-proof'});assert.equal(googleResponse.status,200);
    const google=(await googleResponse.json() as {data:{accessToken:string;session:{profile:{id:string}}}}).data;
    const challengeResponse=await post('/auth/phone/challenges',{phone:'0987654321'});assert.equal(challengeResponse.status,200);
    const challenge=(await challengeResponse.json() as {data:{challengeId:string}}).data;
    const otpResponse=await post('/auth/phone/sessions',{challengeId:challenge.challengeId,code:testCode});assert.equal(otpResponse.status,200);
    const otp=(await otpResponse.json() as {data:{accessToken:string;session:{profile:{id:string;contactVerified:boolean}}}}).data;
    assert.notEqual(otp.session.profile.id,google.session.profile.id);assert.equal(otp.session.profile.contactVerified,true);
    const googleHeaders={Authorization:'Bearer '+google.accessToken,'Content-Type':'application/json'};
    const phoneHeaders={Authorization:'Bearer '+otp.accessToken,'Content-Type':'application/json'};
    assert.equal((await fetch(root+'/me/profile',{method:'PATCH',headers:googleHeaders,body:JSON.stringify({displayName:'Google owner'})})).status,200);
    assert.equal((await fetch(root+'/me/profile',{method:'PATCH',headers:phoneHeaders,body:JSON.stringify({displayName:'Phone owner'})})).status,200);
    const readName=async(headers:Record<string,string>)=>(await (await fetch(root+'/me/profile',{headers})).json() as {data:{displayName:string}}).data.displayName;
    assert.equal(await readName(googleHeaders),'Google owner');assert.equal(await readName(phoneHeaders),'Phone owner');
    assert.equal((await fetch(root+'/auth/sessions/current',{method:'DELETE',headers:phoneHeaders})).status,200);
    assert.equal((await fetch(root+'/auth/session',{headers:phoneHeaders})).status,401);
    assert.equal((await fetch(root+'/auth/session',{headers:googleHeaders})).status,200);
    const replay=await post('/auth/phone/sessions',{challengeId:challenge.challengeId,code:testCode});assert.equal(replay.status,409);
  } finally {server.close();await once(server,'close');await db.close();}
});
