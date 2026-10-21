import type { PoolClient } from 'pg';
import type { z } from 'zod';
import type { CoreService } from './core.js';
import type { Identity } from './auth.js';
import type { Wire } from '../repositories/properties.js';
import { page,type PageQuery } from '../repositories/page.js';
import type { feedQuery } from '../schemas/http.js';
import { DomainError,missing } from '../domain/errors.js';

export class SocialService {
  constructor(readonly core:CoreService){}
  async author(c:PoolClient,id:string):Promise<Wire> {
    const result=(await this.authors(c,[id])).get(id);if(!result)missing();return result;
  }
  async authorProfile(identity:Identity|null,id:string):Promise<Wire>{return this.core.read(identity,async c=>{
    const author=await this.author(c,id);
    const r=(await c.query(`SELECT p.is_illustrative,d.id consultant_id,
      (SELECT count(*)::int FROM xland.videos WHERE author_id=p.id AND deleted_at IS NULL) videos,
      xland.author_follow_count(p.id)::int followers
      FROM xland.user_profiles p LEFT JOIN xland.consultants d ON d.id=p.id WHERE p.id=$1`,[id])).rows[0];
    if(!r)missing();
    return {...author,videoCount:r.videos,followerCount:r.followers,consultantId:r.consultant_id??null,isIllustrative:r.is_illustrative};
  });}
  async authorVideos(identity:Identity|null,id:string,q:PageQuery):Promise<Wire>{return this.core.read(identity,async c=>{
    await this.author(c,id);
    return page(c,this.core.cursor,'author-videos',{user:identity?.userId??null,id},q,'t.*','xland.videos t','t.author_id=$1 AND t.deleted_at IS NULL',[id],'t.published_at','DESC','timestamptz',r=>this.video(c,r),rows=>this.videos(c,rows));
  });}
  private async authors(c:PoolClient,ids:string[]):Promise<Map<string,Wire>> {
    const rows=await c.query(`SELECT p.id,p.display_name,p.public_role,p.avatar_url,p.is_verified,
      d.role consultant_role,d.is_verified consultant_verified,EXISTS(SELECT 1 FROM xland.author_follows f WHERE f.author_id=p.id) following
      FROM xland.user_profiles p LEFT JOIN xland.consultants d ON d.id=p.id WHERE p.id=ANY($1::uuid[])`,[[...new Set(ids)]]);
    return new Map(rows.rows.map(r=>[r.id,{id:r.id,displayName:r.display_name,role:r.consultant_role??r.public_role,avatarUrl:r.avatar_url,isVerified:r.consultant_verified??r.is_verified,isFollowing:r.following}]));
  }
  async get(c:PoolClient,id:string):Promise<Wire> {
    const r=(await c.query('SELECT * FROM xland.videos WHERE id=$1',[id])).rows[0];if(!r)missing();return this.video(c,r);
  }
  async video(c:PoolClient,r:Wire):Promise<Wire> {
    return (await this.videos(c,[r]))[0]!;
  }
  async videos(c:PoolClient,rows:Wire[]):Promise<Wire[]> {
    if(!rows.length)return [];
    const properties=await this.core.properties.getMany(c,rows.map(r=>String(r.property_id)));
    const mediaRows=await c.query('SELECT id,property_id,kind,public_url,thumbnail_url,duration_seconds,alt_text,is_illustrative FROM xland.property_media WHERE id=ANY($1::uuid[])',[[...new Set(rows.map(r=>r.media_id))]]);
    const states=await c.query(`SELECT v.id,xland.video_like_count(v.id)::int likes,
      (SELECT count(*)::int FROM xland.video_comments WHERE video_id=v.id AND deleted_at IS NULL) comments,
      EXISTS(SELECT 1 FROM xland.video_likes WHERE video_id=v.id) liked,EXISTS(SELECT 1 FROM xland.saved_videos WHERE video_id=v.id) saved
      FROM xland.videos v WHERE v.id=ANY($1::uuid[])`,[rows.map(r=>r.id)]);
    const authors=await this.authors(c,rows.map(r=>String(r.author_id)));
    const mediaById=new Map(mediaRows.rows.map(r=>[r.id,r])),stateById=new Map(states.rows.map(r=>[r.id,r]));
    return rows.map(r=>{
     const property=properties.get(String(r.property_id)),media=mediaById.get(r.media_id),state=stateById.get(r.id),author=authors.get(String(r.author_id));
     if(!property||!media||media.property_id!==r.property_id||!state||!author)missing();
     return {id:r.id,propertyId:r.property_id,author,media:{id:media.id,kind:media.kind,url:media.public_url,thumbnailUrl:media.thumbnail_url,durationSeconds:media.duration_seconds,altText:media.alt_text,isIllustrative:media.is_illustrative},
      caption:r.caption,approximateArea:property.districtName,property,likeCount:state.likes,commentCount:state.comments,viewCount:Number(r.view_count),isLiked:state.liked,isSaved:state.saved,publishedAt:(r.published_at as Date).toISOString(),isIllustrative:r.is_illustrative};
    });
  }
  async feed(identity:Identity|null,q:z.infer<typeof feedQuery>):Promise<Wire> {
    if(q.feedScope==='following')this.core.user(identity);
    return this.core.read(identity,async c=>{
      const args:unknown[]=[];const where=['t.deleted_at IS NULL'];
      const add=(sql:string,value:unknown)=>{args.push(value);where.push(sql.replace('?',`$${args.length}`));};
      if(q.region)add('p.region=?',q.region);if(q.category)add('p.category=?',q.category);
      if(q.feedScope==='following')where.push('EXISTS(SELECT 1 FROM xland.author_follows f WHERE f.author_id=t.author_id)');
      return page(c,this.core.cursor,'feed',{user:identity?.userId??null,scope:q.feedScope,region:q.region??null,category:q.category??null},q,'t.*','xland.videos t JOIN xland.properties p ON p.id=t.property_id',where.join(' AND '),args,'t.published_at','DESC','timestamptz',r=>this.video(c,r),rows=>this.videos(c,rows));
    });
  }
  async consultantVideos(identity:Identity|null,id:string,q:PageQuery):Promise<Wire>{return this.core.read(identity,async c=>{
    if(!(await c.query('SELECT id FROM xland.consultants WHERE id=$1',[id])).rowCount)missing();
    return page(c,this.core.cursor,'consultant-videos',{user:identity?.userId??null,id},q,'t.*','xland.videos t','t.author_id=$1',[id],'t.published_at','DESC','timestamptz',r=>this.video(c,r),rows=>this.videos(c,rows));
  });}
  async saved(identity:Identity|null,q:PageQuery):Promise<Wire>{const user=this.core.user(identity);return this.core.read(identity,c=>page(c,this.core.cursor,'saved-videos',{user},q,'t.*','xland.videos t JOIN xland.saved_videos s ON s.video_id=t.id','true',[],'s.created_at','DESC','timestamptz',r=>this.video(c,r),rows=>this.videos(c,rows)));}
  async following(identity:Identity|null,q:PageQuery):Promise<Wire>{const user=this.core.user(identity);return this.core.read(identity,c=>page(c,this.core.cursor,'following',{user},q,'t.id','xland.user_profiles t JOIN xland.author_follows s ON s.author_id=t.id','true',[],'s.created_at','DESC','timestamptz',r=>this.author(c,String(r.id))));}
  async state(identity:Identity|null,id:string,kind:'like'|'saved'|'follow',active:boolean):Promise<Wire>{
    const user=this.core.user(identity);return this.core.write(identity,async c=>{
      if(kind==='follow'){await this.author(c,id);if(id===user)throw new DomainError(409,'CONFLICT','Không thể theo dõi chính mình');}
      else await this.get(c,id);
      const table={like:'video_likes',saved:'saved_videos',follow:'author_follows'}[kind];
      const owner=kind==='follow'?'follower_id':'user_id';const resource=kind==='follow'?'author_id':'video_id';
      if(active)await c.query(`INSERT INTO xland.${table}(${owner},${resource}) VALUES($1,$2) ON CONFLICT DO NOTHING`,[user,id]);
      else await c.query(`DELETE FROM xland.${table} WHERE ${resource}=$1`,[id]);
      const count=kind==='saved'?null:Number((await c.query(`SELECT xland.${kind==='follow'?'author_follow_count':'video_like_count'}($1) count`,[id])).rows[0].count);
      return {active,count};
    });
  }
  async comment(c:PoolClient,r:Wire):Promise<Wire>{return {id:r.id,videoId:r.video_id,author:await this.author(c,String(r.author_id)),text:r.body,createdAt:(r.created_at as Date).toISOString(),canDelete:r.author_id===(await c.query('SELECT xland.current_user_id() id')).rows[0].id};}
  async comments(identity:Identity|null,id:string,q:PageQuery):Promise<Wire>{return this.core.read(identity,async c=>{await this.get(c,id);return page(c,this.core.cursor,'comments',{user:identity?.userId??null,id},q,'t.*','xland.video_comments t','t.video_id=$1 AND t.deleted_at IS NULL',[id],'t.created_at','ASC','timestamptz',r=>this.comment(c,r));});}
  async createComment(identity:Identity|null,id:string,text:string,key:string):Promise<Wire>{this.core.user(identity);return this.core.write(identity,c=>this.core.idempotent(c,identity!,'F06',key,{id,text},async()=>{
    await this.get(c,id);const commentId=this.core.newId();const row=(await c.query('INSERT INTO xland.video_comments(id,video_id,author_id,body) VALUES($1,$2,$3,$4) RETURNING *',[commentId,id,this.core.user(identity),text])).rows[0];
    return {id:commentId,data:await this.comment(c,row)};
  }));}
  async deleteComment(identity:Identity|null,video:string,id:string):Promise<void>{const user=this.core.user(identity);await this.core.write(identity,async c=>{
    await this.get(c,video);const row=(await c.query('SELECT id,author_id,deleted_at FROM xland.video_comments WHERE id=$1 AND video_id=$2',[id,video])).rows[0];if(!row||row.author_id!==user)missing();
    if(!row.deleted_at)await c.query('UPDATE xland.video_comments SET deleted_at=now() WHERE id=$1',[id]);
  });}
}
