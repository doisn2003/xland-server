import { invalid } from '../domain/errors.js';

/** Vietnam mobile numbers only. No inferred ownership from profile contact fields. */
export function normalizeVietnamPhone(value:string):string {
  if(typeof value!=='string'||value.length>40||!/^[+\d\s().-]+$/.test(value))invalid('phone');
  let phone=value.replace(/[\s().-]/g,'');
  if(/^0\d{9}$/.test(phone))phone='+84'+phone.slice(1);
  else if(/^84\d{9}$/.test(phone))phone='+'+phone;
  if(!/^\+84[35789]\d{8}$/.test(phone))invalid('phone');
  return phone;
}
export function maskedPhone(phone:string):string { return '+84 ••• ••• '+phone.slice(-3); }
