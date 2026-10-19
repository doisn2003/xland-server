import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { unauthenticated } from '../domain/errors.js';

export async function externalUserUsing(c:PoolClient,issuer:string,subject:string,phone?:string):Promise<string> {
  // Transaction-scoped lock plus UNIQUE(issuer,subject) prevents duplicate first logins.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['external:'+issuer+':'+subject]);
  const existing=await c.query<{user_id:string;status:string}>(`SELECT e.user_id,u.status FROM xland.auth_external_identities e
    JOIN xland.user_identities u ON u.id=e.user_id WHERE e.issuer=$1 AND e.subject=$2`,[issuer,subject]);
  if(existing.rows[0]) {
    if(existing.rows[0].status!=='active')unauthenticated();
    return existing.rows[0].user_id;
  }
  // Never match email/contactPhone or accept a client-supplied XLand user ID.
  const id=randomUUID();
  await c.query('INSERT INTO xland.user_identities(id,username_normalized,password_hash) VALUES($1,NULL,NULL)',[id]);
  await c.query('INSERT INTO xland.user_profiles(id,display_name) VALUES($1,$2)',[id,'Người dùng XLand']);
  await c.query('INSERT INTO xland.user_contacts(user_id,phone,phone_verified_at) VALUES($1,$2,$3)',[id,phone??null,phone?new Date():null]);
  await c.query('INSERT INTO xland.user_settings(user_id) VALUES($1)',[id]);
  await c.query("INSERT INTO xland.user_roles(user_id,role) VALUES($1,'customer')",[id]);
  await c.query('INSERT INTO xland.auth_external_identities(issuer,subject,user_id) VALUES($1,$2,$3)',[issuer,subject,id]);
  return id;
}
