import { OAuth2Client } from 'google-auth-library';
import type { TokenPayload } from 'google-auth-library';
import { DomainError } from '../domain/errors.js';

export interface VerifiedGoogleIdentity { issuer:'https://accounts.google.com'; subject:string }
export interface GoogleIdentityVerifier { verify(idToken:string):Promise<VerifiedGoogleIdentity> }
export class GoogleTokenVerifier implements GoogleIdentityVerifier {
  constructor(private readonly audiences:readonly string[],private readonly client=new OAuth2Client({transporterOptions:{timeout:8000,retry:false}})) {
    if(!audiences.length||audiences.some(a=>!/^[-\w.]+\.apps\.googleusercontent\.com$/.test(a)))throw new Error('Google audiences must contain OAuth client IDs');
  }
  async verify(idToken:string):Promise<VerifiedGoogleIdentity> {
    if(typeof idToken!=='string'||idToken.length>8192||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(idToken))throw this.invalid();
    let payload:TokenPayload|undefined;
    try {
      const ticket=await this.client.verifyIdToken({idToken,audience:[...this.audiences]});
      payload=ticket.getPayload();
    } catch(error) {
      // Never return SDK errors: some include the original token or upstream payload.
      const code=(error as {code?:string}).code;
      if(['ETIMEDOUT','ENOTFOUND','ECONNRESET','ECONNREFUSED'].includes(code??''))throw new DomainError(503,'UPSTREAM_UNAVAILABLE','Không thể kết nối Google. Vui lòng thử lại.');
      throw this.invalid();
    }
    if(!payload||!['accounts.google.com','https://accounts.google.com'].includes(payload.iss)||
      !this.audiences.includes(payload.aud)||!payload.sub||payload.sub.length>255||payload.exp*1000<=Date.now())throw this.invalid();
    return {issuer:'https://accounts.google.com',subject:payload.sub};
  }
  private invalid():DomainError { return new DomainError(401,'UNAUTHENTICATED','Không xác minh được tài khoản Google. Vui lòng đăng nhập lại.'); }
}
