// Frozen pre-P2-019 read oracle from f8cf948; tests only, never runtime.
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import type { CoreService } from '../../src/services/core.js';
import type { Identity } from '../../src/services/auth.js';
import type { Wire } from '../../src/repositories/properties.js';
import { page,type PageQuery } from '../../src/repositories/page.js';
import type { feedQuery } from '../../src/schemas/http.js';
import { missing } from '../../src/domain/errors.js';

export class LegacySocialService {
  constructor(readonly core:CoreService){}
  async author(c:PoolClient,id:string):Promise<Wire> {
    const r=(await c.query(`SELECT p.id,p.display_name,p.public_role,p.avatar_url,p.is_verified,
      d.role consultant_role,d.is_verified consultant_verified,EXISTS(SELECT 1 FROM xland.author_follows f WHERE f.author_id=p.id) following
      FROM xland.user_profiles p LEFT JOIN xland.consultants d ON d.id=p.id WHERE p.id=$1`,[id])).rows[0];if(!r)missing();
    return {id:r.id,displayName:r.display_name,role:r.consultant_role??r.public_role,avatarUrl:r.avatar_url,isVerified:r.consultant_verified??r.is_verified,isFollowing:r.following};
  }
  async get(c:PoolClient,id:string):Promise<Wire> {
    const r=(await c.query('SELECT * FROM xland.videos WHERE id=$1',[id])).rows[0];if(!r)missing();return this.video(c,r);
  }
  async video(c:PoolClient,r:Wire):Promise<Wire> {
    const property=await this.core.properties.get(c,String(r.property_id));
    const media=(await c.query('SELECT id,kind,public_url,thumbnail_url,duration_seconds,alt_text,is_illustrative FROM xland.property_media WHERE id=$1 AND property_id=$2',[r.media_id,r.property_id])).rows[0];
    const state=(await c.query(`SELECT xland.video_like_count($1)::int likes,
      (SELECT count(*)::int FROM xland.video_comments WHERE video_id=$1 AND deleted_at IS NULL) comments,
      EXISTS(SELECT 1 FROM xland.video_likes WHERE video_id=$1) liked,EXISTS(SELECT 1 FROM xland.saved_videos WHERE video_id=$1) saved`,[r.id])).rows[0];
    return {id:r.id,propertyId:r.property_id,author:await this.author(c,String(r.author_id)),media:{id:media.id,kind:media.kind,url:media.public_url,thumbnailUrl:media.thumbnail_url,durationSeconds:media.duration_seconds,altText:media.alt_text,isIllustrative:media.is_illustrative},
      caption:r.caption,approximateArea:property.districtName,property,likeCount:state.likes,commentCount:state.comments,viewCount:Number(r.view_count),isLiked:state.liked,isSaved:state.saved,publishedAt:(r.published_at as Date).toISOString(),isIllustrative:r.is_illustrative};
  }
  async feed(identity:Identity|null,q:z.infer<typeof feedQuery>):Promise<Wire> {
    if(q.feedScope==='following')this.core.user(identity);
    return this.core.read(identity,async c=>{
      const args:unknown[]=[];const where=['t.deleted_at IS NULL'];
      const add=(sql:string,value:unknown)=>{args.push(value);where.push(sql.replace('?',`$${args.length}`));};
      if(q.region)add('p.region=?',q.region);if(q.category)add('p.category=?',q.category);
      if(q.feedScope==='following')where.push('EXISTS(SELECT 1 FROM xland.author_follows f WHERE f.author_id=t.author_id)');
      return page(c,this.core.cursor,'feed',{user:identity?.userId??null,scope:q.feedScope,region:q.region??null,category:q.category??null},q,'t.*','xland.videos t JOIN xland.properties p ON p.id=t.property_id',where.join(' AND '),args,'t.published_at','DESC','timestamptz',r=>this.video(c,r));
    });
  }
  async consultantVideos(identity:Identity|null,id:string,q:PageQuery):Promise<Wire>{return this.core.read(identity,async c=>{
    if(!(await c.query('SELECT id FROM xland.consultants WHERE id=$1',[id])).rowCount)missing();
    return page(c,this.core.cursor,'consultant-videos',{user:identity?.userId??null,id},q,'t.*','xland.videos t','t.author_id=$1',[id],'t.published_at','DESC','timestamptz',r=>this.video(c,r));
  });}
  async saved(identity:Identity|null,q:PageQuery):Promise<Wire>{const user=this.core.user(identity);return this.core.read(identity,c=>page(c,this.core.cursor,'saved-videos',{user},q,'t.*','xland.videos t JOIN xland.saved_videos s ON s.video_id=t.id','true',[],'s.created_at','DESC','timestamptz',r=>this.video(c,r)));}
}
