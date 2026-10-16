import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { invalid } from '../domain/errors.js';
interface Cursor { scope:string; hash:string; value:string; id:string }
export class CursorCodec {
  constructor(private readonly key:Buffer) {}
  fingerprint(input:unknown):string {return createHash('sha256').update(JSON.stringify(input)).digest('hex');}
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
