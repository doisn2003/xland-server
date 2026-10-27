import type { z } from 'zod';
import type { PoolClient } from 'pg';
import type { CoreService } from './core.js';
import type { Identity } from './auth.js';
import type { Wire } from '../repositories/properties.js';
import { page,type PageQuery } from '../repositories/page.js';
import { missing,invalid,DomainError } from '../domain/errors.js';
import type { supportInput } from '../schemas/http.js';
import type { AvatarStorage,AvatarInput } from './avatar-storage.js';

export class AccountService {
  constructor(readonly core:CoreService,readonly avatarOrigins:readonly string[]=[],readonly avatars?:AvatarStorage){}
  async profile(identity:Identity|null,input:Wire):Promise<Wire> {
    const user=this.core.user(identity);
    if(input.avatarUrl!==undefined&&input.avatarUrl!==null){
      const url=new URL(String(input.avatarUrl));if(url.protocol!=='https:'||url.username||url.password||(!this.avatarOrigins.includes(url.origin)&&!this.avatars?.owns(url.href,user)))throw new DomainError(400,'INVALID_INPUT','Nguồn ảnh đại diện chưa được cho phép');
    }
    let uploaded:string|undefined;
    if(input.avatar){
      if(!this.avatars)throw new DomainError(503,'STORAGE_NOT_CONFIGURED','Chưa cấu hình Supabase Storage ở backend');
      uploaded=await this.avatars.upload(user,input.avatar as AvatarInput);
      input={...input,avatarUrl:uploaded};
    }
    let previousAvatar:string|undefined;
    try{await this.core.write(identity,async c=>{
      if('avatarUrl'in input){
        const prior=(await c.query('SELECT avatar_url FROM xland.user_profiles WHERE id=$1 FOR UPDATE',[user])).rows[0];
        previousAvatar=prior?.avatar_url??undefined;
      }
      if('displayName'in input)await c.query('UPDATE xland.user_profiles SET display_name=$1,updated_at=now() WHERE id=$2',[input.displayName,user]);
      if('avatarUrl'in input)await c.query('UPDATE xland.user_profiles SET avatar_url=$1,updated_at=now() WHERE id=$2',[input.avatarUrl,user]);
      if('contactPhone'in input){await c.query('UPDATE xland.user_contacts SET phone=$1,updated_at=now() WHERE user_id=$2',[input.contactPhone,user]);await c.query('UPDATE xland.user_profiles SET updated_at=now() WHERE id=$1',[user]);}
      if('address'in input){await c.query('UPDATE xland.user_contacts SET address=$1,updated_at=now() WHERE user_id=$2',[input.address||null,user]);await c.query('UPDATE xland.user_profiles SET updated_at=now() WHERE id=$1',[user]);}
    });}catch(error){
      if(uploaded)await this.avatars?.remove(uploaded,user).catch(()=>{});
      throw error;
    }
    if(previousAvatar&&previousAvatar!==input.avatarUrl)await this.avatars?.remove(previousAvatar,user).catch(()=>{});
    return this.core.auth.profile(user);
  }
  async settings(identity:Identity|null,input?:Wire):Promise<Wire> {
    this.core.user(identity);
    const work=async(c:PoolClient)=>{
      if(input)for(const [key,column]of Object.entries({notificationConsent:'notification_consent',feedAutoplay:'feed_autoplay',feedMutedByDefault:'feed_muted_by_default'})){
        if(key in input)await c.query(`UPDATE xland.user_settings SET ${column}=$1,updated_at=now() WHERE user_id=$2`,[input[key],this.core.user(identity)]);
      }
      const r=(await c.query('SELECT * FROM xland.user_settings WHERE user_id=$1',[this.core.user(identity)])).rows[0];if(!r)missing();
      return {notificationConsent:r.notification_consent,locale:r.locale,timeZone:r.time_zone,feedAutoplay:r.feed_autoplay,feedMutedByDefault:r.feed_muted_by_default,updatedAt:r.updated_at.toISOString()};
    };
    return input?this.core.write(identity,work):this.core.read(identity,work);
  }
  club(r:Wire):Wire {return {id:r.id,title:r.title,summary:r.summary,description:r.description,regionLabel:r.region_label,activities:r.activities,media:r.media,supportRecipientLabel:'Đội hỗ trợ XLand (demo)',isIllustrative:r.is_illustrative};}
  async clubs(identity:Identity|null,q:PageQuery):Promise<Wire>{return this.core.read(identity,c=>page(c,this.core.cursor,'clubs',{user:identity?.userId??null},q,'t.*','xland.clubs t','true',[],'t.title','ASC','text',async r=>this.club(r)));}
  async getClub(identity:Identity|null,id:string):Promise<Wire>{return this.core.read(identity,async c=>{const r=(await c.query('SELECT * FROM xland.clubs WHERE id=$1',[id])).rows[0];if(!r)missing();return this.club(r);});}
  support(r:Wire):Wire{return {id:r.id,kind:r.kind,status:r.status,recipientLabel:'Bộ phận hỗ trợ XLand — chưa phân công',notice:'Đã nhận yêu cầu; chờ xử lý, chưa có SLA hoặc tư vấn trực tiếp',createdAt:(r.created_at as Date).toISOString()};}
  async createSupport(identity:Identity|null,input:z.infer<typeof supportInput>,key:string):Promise<Wire>{
    this.core.user(identity);
    if(!input.propertyId&&!input.consultantId)invalid('propertyId');
    return this.core.write(identity,c=>this.core.idempotent(c,identity!,'S01',key,input,async()=>{
      if(input.propertyId)await this.core.properties.get(c,input.propertyId);
      if(input.consultantId&&!(await c.query('SELECT id FROM xland.consultants WHERE id=$1',[input.consultantId])).rowCount)missing();
      const id=this.core.newId();
      const row=(await c.query(`INSERT INTO xland.support_requests(id,user_id,property_id,consultant_id,kind,status,message,contact_name,contact_phone,consent_to_share_contact)
        VALUES($1,$2,$3,$4,$5,'received',$6,$7,$8,true) RETURNING *`,[id,this.core.user(identity),input.propertyId??null,input.consultantId??null,input.kind,input.message,input.contactName,input.contactPhone])).rows[0];
      return {id,data:this.support(row)};
    }));
  }
  async supports(identity:Identity|null,q:PageQuery):Promise<Wire>{this.core.user(identity);return this.core.read(identity,c=>page(c,this.core.cursor,'support',{user:identity!.userId},q,'t.*','xland.support_requests t','true',[],'t.created_at','DESC','timestamptz',async r=>this.support(r)));}
  async plans(identity:Identity|null,q:PageQuery):Promise<Wire>{this.core.user(identity);return this.core.read(identity,c=>page(c,this.core.cursor,'finance-plans',{user:identity!.userId},q,'t.*','xland.saved_finance_plans t','true',[],'t.created_at','DESC','timestamptz',async r=>({id:r.id,propertyId:r.property_id,label:r.label,input:r.input,result:r.result,createdAt:(r.created_at as Date).toISOString()})));}
  async deletePlan(identity:Identity|null,id:string):Promise<void>{await this.core.write(identity,async c=>{if(!(await c.query('DELETE FROM xland.saved_finance_plans WHERE id=$1 RETURNING id',[id])).rowCount)missing();});}
}
