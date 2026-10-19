import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '../repositories/database.js';
import type { AuthService } from '../services/auth.js';
import { DomainError, invalid } from '../domain/errors.js';
import { normalizeVietnamPhone,maskedPhone } from './phone.js';
import { externalUserUsing } from './external-identities.js';
import { takeAuthBudget } from './rate-limit.js';

export interface SmsOtpSender {
  /** A resolved call means provider accepted; delivery itself is established at EXT-L2. */
  send(input:{phone:string;code:string;requestId:string}):Promise<void>;
}
export interface PhoneChallenge {
  challengeId:string;maskedPhone:string;expiresAt:string;resendAt:string;
  deliveryStatus:'pending'|'accepted'|'unknown';
}
interface ChallengeRow {
  id:string;phone:string;code_digest:Buffer;request_digest:Buffer;created_at:Date;expires_at:Date;resend_at:Date;
  attempts:number;status:'pending'|'sent'|'uncertain'|'failed'|'consumed'|'superseded';
}
export const otpPolicy={ttlSeconds:300,resendAfterSeconds:60,codeLength:6,maxAttempts:5,phonePerHour:5,peerPerHour:20,verifyPerMinute:30,globalPerDay:20,globalPer30Days:150} as const;
const rateError=()=>new DomainError(429,'RATE_LIMITED','Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.');
function otpError(code:string):DomainError {
  const messages:Record<string,string>={OTP_INVALID:'Mã OTP không đúng.',OTP_EXPIRED:'Mã OTP đã hết hạn. Vui lòng yêu cầu mã mới.',OTP_CONSUMED:'Mã OTP đã được sử dụng. Vui lòng yêu cầu mã mới.',OTP_LOCKED:'Đã nhập sai quá số lần cho phép. Vui lòng yêu cầu mã mới.',OTP_PENDING:'Tin nhắn đang được xử lý. Vui lòng thử xác minh lại sau.'};
  return new DomainError(409,'CONFLICT',messages[code]??'Mã OTP không còn hiệu lực.',[{field:'code',code}]);
}
export class PhoneOtpService {
  private readonly secret:Buffer;
  constructor(private readonly db:Database,private readonly auth:AuthService,private readonly sender:SmsOtpSender,secret:Buffer,private readonly now:()=>Date=()=>new Date()) {
    if(secret.length<32)throw new Error('OTP HMAC key requires at least 32 bytes');
    this.secret=Buffer.from(secret);
  }
  private hash(scope:string,value:string):Buffer { return createHmac('sha256',this.secret).update(scope+'\0'+value).digest(); }
  private dto(row:ChallengeRow):PhoneChallenge {
    return {challengeId:row.id,maskedPhone:maskedPhone(row.phone),expiresAt:row.expires_at.toISOString(),resendAt:row.resend_at.toISOString(),
      deliveryStatus:row.status==='sent'?'accepted':row.status==='pending'?'pending':'unknown'};
  }
  async request(phoneInput:string,peer:string,idempotencyKey:string):Promise<PhoneChallenge> {
    const phone=normalizeVietnamPhone(phoneInput);
    if(!/^[\x21-\x7e]{16,128}$/.test(idempotencyKey))invalid('idempotencyKey');
    const now=this.now(),id=randomUUID(),code=String(randomInt(0,1000000)).padStart(6,'0');
    const requestDigest=this.hash('request',peer+'\0'+idempotencyKey),phoneHash=this.hash('phone',phone);
    const reserved=await this.db.transaction('xland_auth',null,async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['otp-request:'+requestDigest.toString('hex')]);
      const replay=await c.query<ChallengeRow>('SELECT * FROM xland.auth_otp_challenges WHERE request_digest=$1',[requestDigest]);
      const old=replay.rows[0];
      if(old) {
        if(old.phone!==phone)return {error:new DomainError(409,'IDEMPOTENCY_CONFLICT','Yêu cầu này đã được dùng cho số điện thoại khác.')};
        if(old.status==='failed')return {error:new DomainError(503,'UPSTREAM_UNAVAILABLE','Không gửi được SMS. Vui lòng yêu cầu mã mới sau thời gian chờ.')};
        return {row:old,send:false};
      }
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['otp-phone:'+phoneHash.toString('hex')]);
      const latest=await c.query<ChallengeRow>('SELECT * FROM xland.auth_otp_challenges WHERE phone_hash=$1 ORDER BY created_at DESC LIMIT 1',[phoneHash]);
      if(latest.rows[0]&&latest.rows[0].resend_at>now)return {error:rateError()};
      const peerBudget=await takeAuthBudget(c,this.hash('send-peer',peer),otpPolicy.peerPerHour,3600,now);
      const phoneBudget=await takeAuthBudget(c,this.hash('send-phone',phone),otpPolicy.phonePerHour,3600,now);
      if(!peerBudget||!phoneBudget)return {error:rateError()};
      const dayBudget=await takeAuthBudget(c,this.hash('send-global','day'),otpPolicy.globalPerDay,86400,now);
      const monthBudget=await takeAuthBudget(c,this.hash('send-global','30days'),otpPolicy.globalPer30Days,2592000,now);
      if(!dayBudget||!monthBudget)return {error:rateError()};
      await c.query("UPDATE xland.auth_otp_challenges SET status='superseded' WHERE phone_hash=$1 AND status IN ('sent','pending','uncertain')",[phoneHash]);
      const inserted=await c.query<ChallengeRow>(`INSERT INTO xland.auth_otp_challenges(id,phone,phone_hash,request_digest,code_digest,created_at,expires_at,resend_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[id,phone,phoneHash,requestDigest,this.hash('code',id+'\0'+code),now,new Date(now.getTime()+otpPolicy.ttlSeconds*1000),new Date(now.getTime()+otpPolicy.resendAfterSeconds*1000)]);
      return {row:inserted.rows[0]!,send:true};
    });
    if(reserved.error)throw reserved.error;
    const row=reserved.row!;
    if(!reserved.send)return this.dto(row);
    let status:'sent'|'uncertain'='sent';
    try { await this.sender.send({phone,code,requestId:id}); }
    catch { status='uncertain'; } // Conservative: never re-send an ambiguous paid request.
    await this.db.transaction('xland_auth',null,async c=>{
      await c.query("UPDATE xland.auth_otp_challenges SET status=$2 WHERE id=$1 AND status='pending'",[id,status]);
    });
    row.status=status;
    return this.dto(row);
  }
  async verify(challengeId:string,code:string,peer:string):Promise<Record<string,unknown>> {
    if(!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(challengeId))invalid('challengeId');
    if(!/^\d{6}$/.test(code))invalid('code');
    const result=await this.db.transaction('xland_auth',null,async c=>{
      if(!await takeAuthBudget(c,this.hash('verify-peer',peer),otpPolicy.verifyPerMinute,60,this.now()))return {error:rateError()};
      const locked=await c.query<ChallengeRow>('SELECT * FROM xland.auth_otp_challenges WHERE id=$1 FOR UPDATE',[challengeId]);
      const row=locked.rows[0];
      if(!row)return {error:otpError('OTP_INVALID')};
      if(row.status==='consumed')return {error:otpError('OTP_CONSUMED')};
      if(row.expires_at<=this.now()||row.status==='superseded'||row.status==='failed')return {error:otpError('OTP_EXPIRED')};
      if(row.attempts>=otpPolicy.maxAttempts)return {error:otpError('OTP_LOCKED')};
      if(row.status==='pending')return {error:otpError('OTP_PENDING')};
      const digest=this.hash('code',row.id+'\0'+code);
      if(!timingSafeEqual(row.code_digest,digest)) {
        // Return error after COMMIT: throwing here would roll back attempt accounting.
        await c.query('UPDATE xland.auth_otp_challenges SET attempts=attempts+1 WHERE id=$1',[row.id]);
        return {error:otpError(row.attempts+1>=otpPolicy.maxAttempts?'OTP_LOCKED':'OTP_INVALID')};
      }
      const userId=await this.user(c,row.phone);
      const session=await this.auth.issueSessionUsing(c,userId);
      await c.query("UPDATE xland.auth_otp_challenges SET status='consumed',consumed_at=$2 WHERE id=$1",[row.id,this.now()]);
      return {session};
    });
    if(result.error)throw result.error;
    return result.session!;
  }
  private user(c:PoolClient,phone:string):Promise<string> { return externalUserUsing(c,'urn:xland:phone',phone,phone); }
}
