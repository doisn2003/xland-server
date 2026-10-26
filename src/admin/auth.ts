import {createHash,randomBytes,randomUUID} from 'node:crypto';
import argon2 from 'argon2';
import type {Database} from '../repositories/database.js';
import type {AuthService, Identity} from '../services/auth.js';
import {DomainError,unauthenticated} from '../domain/errors.js';
import {takeAuthBudget} from '../auth/rate-limit.js';

export class AdminAuth {
  private dummy='';
  private sessionCache = new Map<string, Identity>();
  constructor(readonly db:Database,readonly auth:AuthService){}
  async initialize(){this.dummy=await argon2.hash(randomBytes(32),{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});}
  async login(username:string,password:string,peer:string){
    const allowed=await this.db.transaction('xland_auth',null,c=>takeAuthBudget(c,createHash('sha256').update('admin-login:'+peer).digest(),10,60,new Date()));
    if(!allowed)throw new DomainError(429,'RATE_LIMITED','Thử lại sau một phút');
    return this.db.transaction('xland_auth',null,async c=>{
      const row=(await c.query(`SELECT u.id,u.password_hash,u.status,
        (SELECT COALESCE(array_agg(r.role), '{}') FROM xland.user_roles r WHERE r.user_id=u.id) roles
        FROM xland.user_identities u WHERE username_normalized=$1`,[username.trim().toLowerCase()])).rows[0];
      const verified=await argon2.verify(row?.password_hash??this.dummy,password);
      const roles: string[] = row?.roles ?? [];
      const hasAdminAccess = roles.includes('admin') || roles.includes('moderator');
      if(!row||row.status!=='active'||!hasAdminAccess||!verified)unauthenticated();
      const primaryRole = roles.includes('admin') ? 'admin' : 'moderator';
      return {
        ...await this.auth.issueSessionUsing(c,row.id),
        role: primaryRole,
        roles,
      };
    });
  }
  async require(authorization:string|undefined){
    if(authorization===undefined)unauthenticated();
    const matched=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
    if(!matched)unauthenticated();
    const digestHex=createHash('sha256').update(matched[1]!).digest('hex');
    const cached=this.sessionCache.get(digestHex);
    if(cached){
      if(cached.expiresAt.getTime()>Date.now())return cached;
      this.sessionCache.delete(digestHex);
    }
    const identity=await this.auth.identify(authorization);
    if(!identity)unauthenticated();
    const hasAdminAccess = !!(identity.roles?.includes('admin') || identity.roles?.includes('moderator'));
    if(!hasAdminAccess)throw new DomainError(403,'ADMIN_REQUIRED','Tài khoản không có quyền quản trị');
    this.sessionCache.set(digestHex,identity);
    return identity;
  }
  evict(digest:Buffer|string){
    const key=typeof digest==='string'?digest:digest.toString('hex');
    this.sessionCache.delete(key);
  }
  clearCache(){
    this.sessionCache.clear();
  }
}

/** Explicit setup only; never reset a pre-existing account/password at server startup. */
export async function provisionAdmin(db:Database,username:string,password:string){
  const hash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
  return db.transaction('xland_auth',null,async c=>{
    await c.query('SELECT pg_advisory_xact_lock(783134222)');
    const existing=(await c.query('SELECT id FROM xland.user_identities WHERE username_normalized=$1',[username])).rows[0];
    if(existing){
      if(!(await c.query("SELECT 1 FROM xland.user_roles WHERE user_id=$1 AND role='admin'",[existing.id])).rowCount)throw new Error('Existing username is not an admin; no takeover performed');
      return {id:existing.id,created:false};
    }
    const id=randomUUID();
    await c.query('INSERT INTO xland.user_identities(id,username_normalized,password_hash) VALUES($1,$2,$3)',[id,username,hash]);
    await c.query("INSERT INTO xland.user_profiles(id,display_name,public_role) VALUES($1,'Quản trị Xland','Admin')",[id]);
    await c.query('INSERT INTO xland.user_contacts(user_id) VALUES($1)',[id]);
    await c.query('INSERT INTO xland.user_settings(user_id) VALUES($1)',[id]);
    await c.query("INSERT INTO xland.user_roles(user_id,role) VALUES($1,'admin')",[id]);
    return {id,created:true};
  });
}

export async function provisionModerator(db:Database,username:string,password:string){
  const hash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
  return db.transaction('xland_auth',null,async c=>{
    await c.query('SELECT pg_advisory_xact_lock(783134222)');
    const existing=(await c.query('SELECT id FROM xland.user_identities WHERE username_normalized=$1',[username])).rows[0];
    if(existing){
      if(!(await c.query("SELECT 1 FROM xland.user_roles WHERE user_id=$1 AND role='moderator'",[existing.id])).rowCount){
        await c.query("INSERT INTO xland.user_roles(user_id,role) VALUES($1,'moderator') ON CONFLICT DO NOTHING",[existing.id]);
      }
      return {id:existing.id,created:false};
    }
    const id=randomUUID();
    await c.query('INSERT INTO xland.user_identities(id,username_normalized,password_hash) VALUES($1,$2,$3)',[id,username,hash]);
    await c.query("INSERT INTO xland.user_profiles(id,display_name,public_role) VALUES($1,'Kiểm duyệt viên Xland','Moderator')",[id]);
    await c.query('INSERT INTO xland.user_contacts(user_id) VALUES($1)',[id]);
    await c.query('INSERT INTO xland.user_settings(user_id) VALUES($1)',[id]);
    await c.query("INSERT INTO xland.user_roles(user_id,role) VALUES($1,'moderator')",[id]);
    return {id,created:true};
  });
}
