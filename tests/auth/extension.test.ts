import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync,createSign} from 'node:crypto';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {OAuth2Client} from 'google-auth-library';
import {CertificateFormat} from 'google-auth-library/build/src/auth/oauth2client.js';
import argon2 from 'argon2';
import {Database} from '../../src/repositories/database.js';
import {AuthService} from '../../src/services/auth.js';
import {PhoneOtpService} from '../../src/auth/phone-otp.js';
import type {SmsOtpSender} from '../../src/auth/phone-otp.js';
import {ExtendedAuthService} from '../../src/auth/extended-auth.js';
import {GoogleTokenVerifier} from '../../src/auth/google.js';
import {configuredExtendedAuth} from '../../src/auth/config.js';
import {EsmsOtpSender} from '../../src/auth/esms.js';
import {normalizeVietnamPhone} from '../../src/auth/phone.js';
import {extendedAuthRouter} from '../../src/auth/router.js';
import {DomainError} from '../../src/domain/errors.js';
import {createApp} from '../../src/app.js';

const connection=process.env.XLAND_LOGIN_TEST_DB;
if(!connection||new URL(connection).hostname!=='127.0.0.1'||!/^\/xland_test_login_[a-f0-9]{12}$/.test(new URL(connection).pathname))throw new Error('Use isolated auth runner');
const db=new Database(connection);
let clock=new Date('2026-10-19T06:00:00Z');
const now=()=>new Date(clock);
const auth=new AuthService(db,now);await auth.initialize();
after(()=>db.close());
class TestSms implements SmsOtpSender {
  readonly sent:Array<{phone:string;code:string;requestId:string}>=[];
  fail=false;
  async send(input:{phone:string;code:string;requestId:string}) {this.sent.push(input);if(this.fail)throw new Error('ambiguous timeout');}
}
const sender=new TestSms(),secret=randomBytes(32);
const otp=new PhoneOtpService(db,auth,sender,secret,now);
let phoneSequence=0;
const phone=()=>'+8498'+String(++phoneSequence).padStart(7,'0');
const key=()=>randomUUID();
const issue=async(value=phone())=>{
  const challenge=await otp.request(value,'peer:'+value,key());
  const code=sender.sent.findLast(x=>x.requestId===challenge.challengeId)!.code;
  return {challenge,code,phone:value};
};
const error=(code:string,issue?:string)=>(e:unknown)=>e instanceof DomainError&&e.code===code&&(!issue||e.details?.[0]?.code===issue);
const profileId=(response:Record<string,unknown>)=>((response.session as {profile:{id:string}}).profile.id);

test('normalizes domestic/+84/84 mobile; rejects foreign, old/landline, extension and invalid input',()=>{
  for(const value of ['098 123 4567','+84 (98)123-4567','84981234567'])assert.equal(normalizeVietnamPhone(value),'+84981234567');
  for(const value of ['+66981234567','01281234567','0241234567','0981234567 ext1','++84981234567'])assert.throws(()=>normalizeVietnamPhone(value),error('INVALID_INPUT'));
});
test('missing/partial config is disabled; no fake or sandbox runtime fallback',async()=>{
  const service=configuredExtendedAuth(db,auth,{});
  assert.equal(service.capabilities().google.enabled,false);assert.equal(service.capabilities().phoneOtp.enabled,false);
  assert.equal(configuredExtendedAuth(db,auth,{XLAND_PHONE_OTP_ENABLED:'true',XLAND_SMS_PROVIDER:'fake'}).capabilities().phoneOtp.enabled,false);
  await assert.rejects(service.googleSession('bad','peer'),error('FEATURE_NOT_ENABLED'));
});
test('idempotent request across service instances sends once and never returns raw phone/code',async()=>{
  const value=phone(),requestKey=key();
  const before=sender.sent.length;
  const other=new PhoneOtpService(db,auth,sender,secret,now);
  const responses=await Promise.all(Array.from({length:8},(_,i)=>(i%2?otp:other).request(value,'shared-peer',requestKey)));
  assert.equal(new Set(responses.map(r=>r.challengeId)).size,1);assert.equal(sender.sent.length,before+1);
  assert.ok(!JSON.stringify(responses).includes(value));assert.ok(!('code' in responses[0]!));
  await assert.rejects(otp.request(phone(),'shared-peer',requestKey),error('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(otp.request(value,'shared-peer',key()),error('RATE_LIMITED'));
});
test('concurrent verify atomically issues one session and consumes challenge',async()=>{
  const item=await issue();
  const results=await Promise.allSettled(Array.from({length:8},()=>otp.verify(item.challenge.challengeId,item.code,'verify-one')));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,7);
  const winner=results.find(r=>r.status==='fulfilled');assert.ok(winner&&winner.status==='fulfilled');
  const token=winner.value.accessToken as string;assert.match(token,/^[\w-]{43}$/);
  const identity=await auth.identify('Bearer '+token);assert.equal(identity?.userId,profileId(winner.value));
  await assert.rejects(otp.verify(item.challenge.challengeId,item.code,'replay'),error('CONFLICT','OTP_CONSUMED'));
  await auth.logout(identity!);await assert.rejects(auth.identify('Bearer '+token),error('UNAUTHENTICATED'));
});
test('wrong attempts commit and lock exactly at limit',async()=>{
  const item=await issue();const wrong=item.code==='000000'?'000001':'000000';
  for(let i=0;i<5;i++)await assert.rejects(otp.verify(item.challenge.challengeId,wrong,'attempt-peer'),error('CONFLICT',i===4?'OTP_LOCKED':'OTP_INVALID'));
  await assert.rejects(otp.verify(item.challenge.challengeId,item.code,'attempt-peer'),error('CONFLICT','OTP_LOCKED'));
});
test('expiry rejects correct code; resend invalidates previous code and maps same verified phone',async()=>{
  const first=await issue();
  clock=new Date(clock.getTime()+300001);
  await assert.rejects(otp.verify(first.challenge.challengeId,first.code,'expiry'),error('CONFLICT','OTP_EXPIRED'));
  const second=await issue(first.phone);
  const session=await otp.verify(second.challenge.challengeId,second.code,'second');
  clock=new Date(clock.getTime()+60001);
  const third=await issue(first.phone);
  const session2=await otp.verify(third.challenge.challengeId,third.code,'third');
  assert.equal(profileId(session),profileId(session2));
  const pending=await issue();clock=new Date(clock.getTime()+60001);
  await issue(pending.phone);
  await assert.rejects(otp.verify(pending.challenge.challengeId,pending.code,'superseded'),error('CONFLICT','OTP_EXPIRED'));
});
test('timeout after provider acceptance is not automatically re-sent; delivered code can verify',async()=>{
  sender.fail=true;
  const value=phone(),requestKey=key();const before=sender.sent.length;
  const first=await otp.request(value,'timeout-peer',requestKey);
  sender.fail=false;
  assert.equal(first.deliveryStatus,'unknown');
  assert.equal((await otp.request(value,'timeout-peer',requestKey)).challengeId,first.challengeId);
  assert.equal(sender.sent.length,before+1);
  await otp.verify(first.challengeId,sender.sent.at(-1)!.code,'timeout-verify');
});
test('repeated malformed/unknown challenges hit persistent verify IP rate limit',async()=>{
  const id=randomUUID();
  for(let i=0;i<30;i++)await assert.rejects(otp.verify(id,'123456','rate-peer'),error('CONFLICT'));
  await assert.rejects(otp.verify(id,'123456','rate-peer'),error('RATE_LIMITED'));
});
test('Google library cryptographically verifies signature/aud/iss/exp; never exposes rejected token',async()=>{
  const pair=generateKeyPairSync('rsa',{modulusLength:2048});
  const client=new OAuth2Client();
  client.getFederatedSignonCertsAsync=async()=>({certs:{test:pair.publicKey.export({type:'spki',format:'pem'}).toString()},format:CertificateFormat.PEM});
  const audience='123-test.apps.googleusercontent.com';
  const verifier=new GoogleTokenVerifier([audience],client);
  const seconds=Math.floor(Date.now()/1000);
  const token=(extra:Record<string,unknown>={})=>{
    const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
    const body=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',sub:'google-subject',aud:audience,iat:seconds,exp:seconds+600,...extra})).toString('base64url');
    return head+'.'+body+'.'+createSign('RSA-SHA256').update(head+'.'+body).sign(pair.privateKey).toString('base64url');
  };
  assert.equal((await verifier.verify(token())).subject,'google-subject');
  assert.equal((await verifier.verify(token({iss:'accounts.google.com'}))).issuer,'https://accounts.google.com');
  for(const bad of [token({aud:'attacker'}),token({iss:'https://attacker.invalid'}),token({exp:seconds-600}),token()+'.extra','not-a-token']) {
    await assert.rejects(verifier.verify(bad),e=>error('UNAUTHENTICATED')(e)&&!(e as Error).message.includes(bad));
  }
  const signed=token();const parts=signed.split('.');
  parts[2]=Buffer.alloc(256).toString('base64url');await assert.rejects(verifier.verify(parts.join('.')),error('UNAUTHENTICATED'));
});
test('Google stable sub provisions once; does not merge with an existing profile contact',async()=>{
  const oldId=randomUUID(),contactPhone=phone();
  const password='login_test_password';const hash=await argon2.hash(password);
  await db.transaction('xland_auth',null,async c=>{
    await c.query('INSERT INTO xland.user_identities(id,username_normalized,password_hash) VALUES($1,$2,$3)',[oldId,'login_old_owner',hash]);
    await c.query("INSERT INTO xland.user_profiles(id,display_name) VALUES($1,'Old owner')",[oldId]);
    await c.query('INSERT INTO xland.user_contacts(user_id,phone,email_contact) VALUES($1,$2,$3)',[oldId,contactPhone,'same@example.invalid']);
    await c.query('INSERT INTO xland.user_settings(user_id) VALUES($1)',[oldId]);
  });
  const service=new ExtendedAuthService(db,auth,{verify:async()=>({issuer:'https://accounts.google.com',subject:'stable-sub'})});
  const logins=await Promise.all([service.googleSession('test-only','google-peer'),service.googleSession('test-only','google-peer')]);
  assert.equal(profileId(logins[0]!),profileId(logins[1]!));assert.notEqual(profileId(logins[0]!),oldId);
  const otpItem=await issue(contactPhone);const phoneSession=await otp.verify(otpItem.challenge.challengeId,otpItem.code,'contact');
  assert.notEqual(profileId(phoneSession),oldId);assert.notEqual(profileId(phoneSession),profileId(logins[0]!));
  assert.equal(profileId(await auth.login({username:'login_old_owner',password},'legacy')),oldId);
  await db.transaction('xland_auth',null,c=>c.query("UPDATE xland.user_identities SET status='disabled',disabled_at=now() WHERE id=$1",[profileId(logins[0]!)]));
  await assert.rejects(service.googleSession('test-only','google-peer'),error('UNAUTHENTICATED'));
});
test('OTP tables are inaccessible to API role',async()=>{
  await assert.rejects(db.transaction('xland_api',null,c=>c.query('SELECT code_digest FROM xland.auth_otp_challenges')),e=>(e as {code:string}).code==='42501');
});
test('HTTP contracts reject userId and unknown fields, permit public auth despite old bearer',async()=>{
  const service=new ExtendedAuthService(db,auth);
  const server=createApp({checkReadiness:async()=>true,api:extendedAuthRouter(service)}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const root=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  try {
    const cap=await fetch(root+'/auth/capabilities',{headers:{Authorization:'Bearer invalid'}});assert.equal(cap.status,200);
    const send=async(path:string,body:unknown)=>fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key(),Authorization:'Bearer invalid'},body:JSON.stringify(body)});
    assert.equal((await send('/auth/google/sessions',{idToken:'bad',userId:randomUUID()})).status,400);
    assert.equal((await send('/auth/google/sessions',{idToken:'bad'})).status,503);
    assert.equal((await send('/auth/phone/challenges',{phone:phone(),verified:true})).status,400);
    assert.equal((await send('/auth/phone/challenges',{phone:phone()})).status,503);
    assert.equal((await send('/auth/phone/sessions',{challengeId:randomUUID(),code:'123456',userId:randomUUID()})).status,400);
  } finally {server.close();await once(server,'close');}
});
test('eSMS adapter uses approved sender, CSKH, one request ID and no retries; sanitizes provider rejection',async()=>{
  let calls=0;
  const fake:typeof fetch=async(url,options)=>{
    calls++;assert.equal(url,'https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/');
    const body=JSON.parse(options!.body as string);assert.equal(body.Brandname,'Xgroup');assert.equal(body.SmsType,'2');
    assert.equal(body.Sandbox,'0');assert.equal(body.RequestId,'request-id');assert.equal(body.Content,'XLand OTP 123456');
    return new Response(JSON.stringify({CodeResult:'146',ErrorMessage:'SECRET_TOKEN_AND_OTP'}),{status:200});
  };
  const sms=new EsmsOtpSender({apiKey:'test-key',secretKey:'test-secret',brandname:'Xgroup',approvedTemplate:'XLand OTP {CODE}'},fake);
  await assert.rejects(sms.send({phone:'+84981234567',code:'123456',requestId:'request-id'}),e=>error('UPSTREAM_UNAVAILABLE')(e)&&!(e as Error).message.includes('SECRET'));
  assert.equal(calls,1);
});
test('phone send budget survives resend intervals and global budget caps total SMS cost',async()=>{
  const value=phone();
  for(let i=0;i<5;i++) {
    await otp.request(value,'phone-rate-budget',key());
    clock=new Date(clock.getTime()+60001);
  }
  await assert.rejects(otp.request(value,'phone-rate-budget',key()),error('RATE_LIMITED'));
  let blocked=false;
  for(let i=0;i<25;i++) {
    try {await issue();} catch(e) {assert.ok(error('RATE_LIMITED')(e));blocked=true;break;}
  }
  assert.equal(blocked,true);assert.equal(sender.sent.length,20);
});
