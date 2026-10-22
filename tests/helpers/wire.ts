import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const schemas=new Map<string,Array<{type:string;key:string}>>();
const enums=new Map<string,string[]>();
// A pinned, checksummed snapshot makes the oracle reproducible on a fresh
// backend checkout. An explicit live checkout must exist; never silently fall back.
const mobileRoot=process.env.XLAND_MOBILE_ROOT?resolve(process.env.XLAND_MOBILE_ROOT):fileURLToPath(new URL('../fixtures/mobile/',import.meta.url));
const common=readFileSync(resolve(mobileRoot,'lib/domain/entities/common.dart'),'utf8');
const overrides:Record<string,string>={below100:'below_100',from100To200:'from_100_to_200',above200:'above_200'};
for(const [,name,values]of common.matchAll(/enum (\w+) \{([\s\S]*?)\}/g))enums.set(name!,values!.split(',').map(s=>s.trim()).filter(s=>/^[a-z]\w*$/.test(s)).map(v=>overrides[v]??v.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())));
for(const file of ['common','property','social','consultant','event','booking','account','finance']){
  const source=readFileSync(resolve(mobileRoot,`lib/domain/entities/${file}.dart`),'utf8');
  for(const [,name,body]of source.matchAll(/final class (\w+)[^{]*\{([\s\S]*?)\n\}/g))schemas.set(name!,[...body!.matchAll(/final ([\w<>?]+) (\w+);/g)].map(([,type,key])=>({type:type!,key:key!})));
}
export function assertWire(value:unknown,type:string,path='data'):void {
  if(type.endsWith('?')){if(value===null)return;assertWire(value,type.slice(0,-1),path);return;}
  if(type.startsWith('List<')){assert.ok(Array.isArray(value),path);for(const item of value)assertWire(item,type.slice(5,-1),path+'[]');return;}
  if(enums.has(type)){assert.ok(enums.get(type)!.includes(String(value)),path+' enum '+type);return;}
  if(['String','Vnd','DecimalValue','DateTime','Uri'].includes(type)){
    assert.equal(typeof value,'string',path);const string=value as string;
    if(type==='Vnd')assert.match(string,/^(0|[1-9][0-9]{0,19})$/,path);
    if(type==='DecimalValue')assert.match(string,/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/,path);
    if(type==='DateTime'){assert.match(string,/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/,path);assert.ok(Number.isFinite(Date.parse(string)),path);}
    if(type==='Uri'){const url=new URL(string);assert.equal(url.protocol,'https:',path);assert.equal(url.username,'');assert.equal(url.password,'');}
    if(path.endsWith('.checkedDate')||path.endsWith('.uploadedDate')){assert.match(string,/^\d{4}-\d{2}-\d{2}$/);assert.equal(new Date(string).toISOString().slice(0,10),string);}
    return;
  }
  if(type==='int'){assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0,path);return;}
  if(type==='double'){assert.ok(typeof value==='number'&&Number.isFinite(value),path);return;}
  if(type==='bool'){assert.equal(typeof value,'boolean',path);return;}
  const fields=schemas.get(type);assert.ok(fields,'Unknown Dart schema '+type);
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),path);
  // The current mobile mappers deliberately accept omitted descriptions on legacy
  // agenda/speaker objects (value['description'], rather than wireField()).
  const optional=new Set(['AgendaItem','Speaker'].includes(type)?['description']:[]);
  const present=fields.filter(f=>!optional.has(f.key)||Object.hasOwn(value,f.key));
  assert.deepEqual(Object.keys(value).sort(),present.map(f=>f.key).sort(),path+' '+type+' fields');
  for(const field of present)assertWire((value as Record<string,unknown>)[field.key],field.type,path+'.'+field.key);
}
