import type { PoolClient } from 'pg';
import type { CursorCodec } from '../services/cursor.js';
import type { Wire } from './properties.js';
export interface PageQuery {limit:number;cursor?:string|undefined}
export async function page(c:PoolClient,codec:CursorCodec,scope:string,context:unknown,q:PageQuery,
  select:string,from:string,where:string,args:unknown[],column:string,direction:'ASC'|'DESC',cast:'timestamptz'|'text',map:(r:Wire)=>Promise<Wire>,batch?:((rows:Wire[])=>Promise<Wire[]>)):Promise<Wire> {
  // SQL fragments are trusted literals selected by repository code; all request values are bound.
  const values=[...args];const hash=codec.fingerprint(context);let after='';
  if(q.cursor){const cursor=codec.decode(q.cursor,scope,hash);values.push(cursor.value,cursor.id);after=` AND (${column},t.id) ${direction==='ASC'?'>':'<'} ($${values.length-1}::${cast},$${values.length}::uuid)`;}
  values.push(q.limit+1);
  const rows=await c.query<Wire>(`SELECT ${select},${column}::text cursor_value FROM ${from} WHERE ${where}${after} ORDER BY ${column} ${direction},t.id ${direction} LIMIT $${values.length}`,values);
  const selected=rows.rows.slice(0,q.limit);const data:Wire[]=batch?await batch(selected):[];
  if(!batch)for(const row of selected)data.push(await map(row));
  const more=rows.rows.length>q.limit;const last=selected.at(-1);
  return {data,meta:{total:null,hasMore:more,nextCursor:more&&last?codec.encode({scope,hash,value:String(last.cursor_value),id:String(last.id)}):null}};
}
