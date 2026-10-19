import { createHash } from 'node:crypto';
import type { Database } from '../repositories/database.js';
import type { AuthService } from '../services/auth.js';
import { DomainError } from '../domain/errors.js';
import type { GoogleIdentityVerifier } from './google.js';
import { externalUserUsing } from './external-identities.js';
import { otpPolicy } from './phone-otp.js';
import type { PhoneOtpService } from './phone-otp.js';
import { takeAuthBudget } from './rate-limit.js';

export class ExtendedAuthService {
  constructor(private readonly db:Database,private readonly auth:AuthService,private readonly google?:GoogleIdentityVerifier,readonly phone?:PhoneOtpService) {}
  capabilities() {
    return {usernamePassword:true,google:{enabled:!!this.google},phoneOtp:{enabled:!!this.phone,
      reason:this.phone?null:'PROVIDER_NOT_CONFIGURED',ttlSeconds:otpPolicy.ttlSeconds,resendAfterSeconds:otpPolicy.resendAfterSeconds,codeLength:otpPolicy.codeLength}};
  }
  async googleSession(idToken:string,peer:string):Promise<Record<string,unknown>> {
    if(!this.google)throw new DomainError(503,'FEATURE_NOT_ENABLED','Đăng nhập Google chưa sẵn sàng.');
    const allowed=await this.db.transaction('xland_auth',null,c=>takeAuthBudget(c,createHash('sha256').update('google:'+peer).digest(),30,60,new Date()));
    if(!allowed)throw new DomainError(429,'RATE_LIMITED','Vui lòng thử lại sau.');
    const verified=await this.google.verify(idToken);
    return this.db.transaction('xland_auth',null,async c=>{
      const userId=await externalUserUsing(c,verified.issuer,verified.subject);
      return this.auth.issueSessionUsing(c,userId);
    });
  }
}
