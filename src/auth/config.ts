import type { Database } from '../repositories/database.js';
import type { AuthService } from '../services/auth.js';
import { ExtendedAuthService } from './extended-auth.js';
import { GoogleTokenVerifier } from './google.js';
import { PhoneOtpService } from './phone-otp.js';
import { EsmsOtpSender } from './esms.js';

/** Explicit allow flags: merely adding a key never starts a paid provider. No fake mode. */
export function configuredExtendedAuth(db:Database,auth:AuthService,env:NodeJS.ProcessEnv):ExtendedAuthService {
  const audiences=(env.GOOGLE_AUTH_AUDIENCES??'').split(',').map(s=>s.trim()).filter(Boolean);
  const google=env.XLAND_GOOGLE_LOGIN_ENABLED==='true'&&audiences.length?new GoogleTokenVerifier(audiences):undefined;
  const secret=env.OTP_HMAC_KEY;
  const phone=env.XLAND_PHONE_OTP_ENABLED==='true'&&env.XLAND_SMS_PROVIDER==='esms'&&env.SMS_BRANDNAME_APPROVED==='true'&&
    env.ESMS_API_KEY&&env.ESMS_SECRET_KEY&&env.SMS_BRANDNAME&&env.SMS_OTP_TEMPLATE&&secret&&Buffer.byteLength(secret)>=32
    ?new PhoneOtpService(db,auth,new EsmsOtpSender({apiKey:env.ESMS_API_KEY,secretKey:env.ESMS_SECRET_KEY,
      brandname:env.SMS_BRANDNAME,approvedTemplate:env.SMS_OTP_TEMPLATE}),Buffer.from(secret)):undefined;
  return new ExtendedAuthService(db,auth,google,phone);
}
