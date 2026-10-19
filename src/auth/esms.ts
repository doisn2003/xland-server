import { DomainError } from '../domain/errors.js';
import type { SmsOtpSender } from './phone-otp.js';

export interface EsmsConfig { apiKey:string;secretKey:string;brandname:string;approvedTemplate:string }
/** Candidate adapter; never instantiated until provider + Brandname + template are approved. */
export class EsmsOtpSender implements SmsOtpSender {
  constructor(private readonly config:EsmsConfig,private readonly request:typeof fetch=fetch) {
    if(!config.apiKey||!config.secretKey||!config.brandname||
      config.approvedTemplate.split('{CODE}').length!==2||/[^\x20-\x7e]|`/.test(config.approvedTemplate)||
      [...config.approvedTemplate.replace('{CODE}','000000')].reduce((units,char)=>units+('^{}\\[~]|'.includes(char)?2:1),0)>160) {
      throw new Error('eSMS requires credentials, Brandname and one approved ASCII {CODE} template');
    }
  }
  async send(input:{phone:string;code:string;requestId:string}):Promise<void> {
    try {
      const response=await this.request('https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/',{
        method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),
        body:JSON.stringify({ApiKey:this.config.apiKey,SecretKey:this.config.secretKey,Brandname:this.config.brandname,
          Content:this.config.approvedTemplate.replace('{CODE}',input.code),Phone:input.phone.replace('+',''),
          SmsType:'2',IsUnicode:'0',Sandbox:'0',RequestId:input.requestId})});
      const data:unknown=await response.json();
      if(!response.ok||typeof data!=='object'||data===null||!('CodeResult' in data)||data.CodeResult!=='100')throw new Error();
    } catch {
      // No retry, no provider error echo: secrets/OTP may be present in response.
      throw new DomainError(503,'UPSTREAM_UNAVAILABLE','Chưa xác nhận được yêu cầu gửi SMS.');
    }
  }
}
