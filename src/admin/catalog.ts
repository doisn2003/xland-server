export interface Entity {
  table:string; title:string; columns:string[]; search:string[]; create?:boolean;
  edit?:string[]; readonly?:string[]; filter?:string[];
}
export const entities:Record<string,Entity> = {
  properties:{table:'properties',title:'Lô đất',columns:['code','title','province','area_m2','price_total','status','approval_status'],search:['code','title','province','district'],create:true,filter:['status','approval_status','consultant_id']},
  videos:{table:'videos',title:'Video feeds',columns:['caption','property_id','author_id','approval_status','published_at','deleted_at'],search:['caption'],create:true,readonly:['view_count'],filter:['property_id','approval_status']},
  consultants:{table:'consultants',title:'Tư vấn viên',columns:['name','role','location','is_verified','rating'],search:['name','role','location'],create:true,readonly:['video_count','follower_count','rating','next_available_slot'],filter:[]},
  bookings:{table:'site_visit_bookings',title:'Lịch xem thực địa',columns:['customer_name','customer_phone','property_id','requested_starts_at','attendee_count','status'],search:['customer_name','customer_phone','note'],edit:['consultant_id','status','confirmed_starts_at','confirmed_meeting_label'],filter:['status','property_id','consultant_id']},
  slots:{table:'site_visit_slots',title:'Khung giờ thực địa',columns:['label','property_id','starts_at','ends_at','max_bookings','status'],search:['label'],create:true,filter:['property_id','status','consultant_id']},
  support:{table:'support_requests',title:'Yêu cầu hỗ trợ',columns:['contact_name','contact_phone','kind','status','created_at'],search:['contact_name','contact_phone','message'],edit:['status','recipient_id','consultant_id'],filter:['status','kind']},
  media:{table:'property_media',title:'Ảnh & media lô đất',columns:['alt_text','property_id','kind','usage','sort_order'],search:['alt_text'],create:true,filter:['property_id','kind','usage']},
  legal:{table:'property_legal_items',title:'Hồ sơ pháp lý',columns:['title','property_id','status','checked_date'],search:['title','subtitle'],create:true,filter:['property_id','status']},
  documents:{table:'property_documents',title:'Tài liệu lô đất',columns:['title','property_id','file_type','access_level','uploaded_date'],search:['title'],create:true,filter:['property_id','access_level']},
  amenities:{table:'property_nearby_amenities',title:'Tiện ích khu vực',columns:['name','property_id','category','distance_text'],search:['name'],create:true,filter:['property_id','category']},
  events:{table:'events',title:'Sự kiện',columns:['title','venue_name','starts_at','max_slots','status'],search:['title','venue_name','address'],create:true,filter:['status']},
  registrations:{table:'event_registrations',title:'Đăng ký sự kiện',columns:['contact_name','contact_phone','event_id','attendee_count','status'],search:['contact_name','contact_phone'],edit:[],filter:['event_id','status']},
  clubs:{table:'clubs',title:'Câu lạc bộ',columns:['title','region_label','summary'],search:['title','region_label'],create:true},
  users:{table:'user_profiles',title:'Người dùng',columns:['display_name','public_role','is_verified','created_at'],search:['display_name'],edit:[]},
  audit:{table:'admin_audit_log',title:'Nhật ký quản trị',columns:['created_at','actor_id','action','entity','record_id','changed_fields'],search:['action','entity'],edit:[]},
};
export const enums:Record<string,string[]> = {
  region:['north','central','south'],category:['residential','industrial','agricultural','other'],land_type:['residential','agricultural','other'],
  direction:['north','northeast','east','southeast','south','southwest','west','northwest'],status_badge:['board_source','standard'],approval_status:['pending','approved'],
  'properties.status':['listed','paused','sold'],'bookings.status':['draft','awaiting_deposit','pending_confirmation','confirmed','completed','expired','cancel_requested','cancelled','reschedule_requested','rejected','no_show'],
  'slots.status':['open','closed'],'support.status':['received','pending','responded','closed'],'events.status':['open','sold_out','closed','cancelled'],
  'registrations.status':['pending','registered','cancelled'],'legal.status':['pending','verified'],
  'media.kind':['image','video'],usage:['gallery','area','feed'],
  'amenities.category':['utility','traffic','living'],icon_type:['school','hospital','market','road','other'],
  mime_type:['application/pdf','image/jpeg','image/png'],access_level:['public_redacted','authenticated','granted'],
};
export const references:Record<string,string> = {property_id:'properties',consultant_id:'consultants',author_id:'users',user_id:'users',recipient_id:'users',support_recipient_id:'users',actor_id:'users',media_id:'media',source_video_id:'videos',slot_id:'slots',event_id:'events'};
export const automatic=new Set(['id','created_at','updated_at','price_per_m2','event_date','start_time','end_time','visit_date','time_slot']);
