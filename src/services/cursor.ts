import { createHash, createHmac, timingSafeEqual,createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { invalid } from '../domain/errors.js';
interface Cursor { scope:string; hash:string; value:string; id:string }
export class CursorCodec {
  constructor(private readonly key:Buffer) {}
  fingerprint(input:unknown):string {
    const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
    return createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
  }
  seal(value:unknown,scope:string):Record<string,string> {
    const nonce=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(this.key).update('idempotency').digest(),nonce);
    cipher.setAAD(Buffer.from(scope));const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return {ciphertext:encrypted.toString('base64url'),nonce:nonce.toString('base64url'),tag:cipher.getAuthTag().toString('base64url')};
  }
  open(value:Record<string,string>,scope:string):unknown {
    const cipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(this.key).update('idempotency').digest(),Buffer.from(value.nonce!,'base64url'));
    cipher.setAAD(Buffer.from(scope));cipher.setAuthTag(Buffer.from(value.tag!,'base64url'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.ciphertext!,'base64url')),cipher.final()]).toString());
  }
  encode(cursor:Cursor):string {
    const body=Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return body+'.'+createHmac('sha256',this.key).update(body).digest('base64url');
  }
  decode(value:string,scope:string,hash:string):Cursor {
    try {
      const [body,signature,...extra]=value.split('.');
      if(!body||!signature||extra.length)invalid('cursor');
      const expected=createHmac('sha256',this.key).update(body).digest();
      const actual=Buffer.from(signature,'base64url');
      if(expected.length!==actual.length||!timingSafeEqual(expected,actual))invalid('cursor');
      const decoded=JSON.parse(Buffer.from(body,'base64url').toString()) as Cursor;
      if(decoded.scope!==scope||decoded.hash!==hash||typeof decoded.value!=='string'||!/^[0-9a-f-]{36}$/i.test(decoded.id))invalid('cursor');
      return decoded;
    }catch{invalid('cursor');}
  }
}
