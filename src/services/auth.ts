import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { PoolClient } from 'pg';
import type { Database } from '../repositories/database.js';
import { DomainError, invalid, unauthenticated } from '../domain/errors.js';

export interface Identity { userId: string; digest: Buffer; expiresAt: Date }
export interface LoginInput { username: string; password: string }
export class AuthService {
  private readonly attempts=new Map<string,{count:number;until:number}>();
  private dummyHash='';
  constructor(private readonly db: Database, private readonly now: ()=>Date=()=>new Date(), private readonly maxAttempts=10) {}
  async initialize(): Promise<void> {
    this.dummyHash=await argon2.hash(randomBytes(32),{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
  }
  async login(input: LoginInput, peer: string): Promise<Record<string,unknown>> {
    const username=input.username.trim().toLowerCase();
    if(!/^[a-z0-9._-]{3,64}$/.test(username))invalid('username');
    if([...input.password].length<8||[...input.password].length>128||input.password.includes('\0'))invalid('password');
    const key=createHash('sha256').update(peer).digest('hex');
    const time=this.now().getTime();
    for(const [k,v]of this.attempts)if(v.until<=time)this.attempts.delete(k);
    const window=this.attempts.get(key)??{count:0,until:time+60000};
    if(window.count>=this.maxAttempts||this.attempts.size>10000)throw new DomainError(429,'RATE_LIMITED','Thử lại sau');
    window.count++;this.attempts.set(key,window);
    return this.db.transaction('xland_auth',null,async c=>{
      const rows=await c.query<{id:string;password_hash:string;status:string}>('SELECT id,password_hash,status FROM xland.user_identities WHERE username_normalized=$1',[username]);
      const row=rows.rows[0];
      const verified=await argon2.verify(row?.password_hash??this.dummyHash,input.password);
      if(!row||row.status!=='active'||!verified)unauthenticated();
      const token=randomBytes(32).toString('base64url');
      const digest=createHash('sha256').update(token).digest();
      const created=this.now();const expires=new Date(created.getTime()+86400000);
      await c.query('INSERT INTO xland.auth_sessions(id,user_id,token_digest,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[randomUUID(),row.id,digest,created,expires]);
      return {accessToken:token,session:{profile:await this.profileUsing(c,row.id),expiresAt:expires.toISOString()}};
    });
  }
  async identify(authorization: string|undefined): Promise<Identity|null> {
    if(authorization===undefined)return null;
    const matched=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
    if(!matched)unauthenticated();
    const digest=createHash('sha256').update(matched[1]!).digest();
    return this.db.transaction('xland_auth',null,async c=>{
      const result=await c.query<{user_id:string;expires_at:Date}>(`SELECT s.user_id,s.expires_at FROM xland.auth_sessions s
        JOIN xland.user_identities u ON u.id=s.user_id WHERE s.token_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>$2 AND u.status='active'`,[digest,this.now()]);
      const row=result.rows[0];if(!row)unauthenticated();
      return {userId:row.user_id,digest,expiresAt:row.expires_at};
    });
  }
  async profile(id:string): Promise<Record<string,unknown>> {
    return this.db.transaction('xland_auth',id,c=>this.profileUsing(c,id));
  }
  private async profileUsing(c:PoolClient,id:string):Promise<Record<string,unknown>> {
      const result=await c.query(`SELECT p.id,p.display_name,p.avatar_url,p.updated_at,c.phone,c.phone_verified_at
        FROM xland.user_profiles p JOIN xland.user_contacts c ON c.user_id=p.id WHERE p.id=$1`,[id]);
      const p=result.rows[0];if(!p)unauthenticated();
      return {id:p.id,displayName:p.display_name,avatarUrl:p.avatar_url,contactPhone:p.phone,contactVerified:p.phone_verified_at!==null,updatedAt:p.updated_at.toISOString()};
  }
  async logout(identity:Identity): Promise<void> {
    await this.db.transaction('xland_auth',identity.userId,async c=>{
      await c.query('UPDATE xland.auth_sessions SET revoked_at=$2 WHERE token_digest=$1 AND revoked_at IS NULL',[identity.digest,this.now()]);
    });
  }
}
