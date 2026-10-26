import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
import {Router} from 'express';
import {localPostgres} from '../../scripts/local-postgres.mjs';
import {migrate} from '../../src/repositories/migrations.ts';
import {Database} from '../../src/repositories/database.ts';
import {seed,randomTestAccount} from '../../src/repositories/seed.ts';
import {AuthService} from '../../src/services/auth.ts';
import {CoreService} from '../../src/services/core.ts';
import {CursorCodec} from '../../src/services/cursor.ts';
import {createApp} from '../../src/app.ts';
import {apiRouter} from '../../src/routes/v1/api.ts';
import {adminRouter} from '../../src/admin/router.ts';
import {provisionAdmin, AdminAuth} from '../../src/admin/auth.ts';
import {assertWire} from '../helpers/wire.ts';
import {storageFixture} from './storage-fixture.mjs';
import {validateStorageReferences} from '../../src/admin/uploads.ts';

const local=await localPostgres({directory:resolve('.local/admin-tests'),port:55445});
const root=new pg.Client({connectionString:local.rootUrl});let db,server,storage,databaseName,checks=0;
try{
  await root.connect();const name='xland_test_admin_'+randomBytes(5).toString('hex');await root.query(`CREATE DATABASE ${name}`);databaseName=name;
  const url=new URL(local.rootUrl);url.pathname='/'+name;db=new Database(url.toString());
  await migrate(db.pool);const user=randomTestAccount();await seed(db.pool,[user]);
  const admin=await provisionAdmin(db,'admin','123456');assert.equal(admin.created,true);assert.equal((await provisionAdmin(db,'admin','different-password')).created,false);
  const auth=new AuthService(db);await auth.initialize();const core=new CoreService(db,auth,new CursorCodec(randomBytes(32)));
  storage=await storageFixture();
  const access=new AdminAuth(db,auth);await access.initialize();
  const router=Router().use('/admin',await adminRouter(db,auth,storage.env,access)).use(apiRouter(core));
  server=createApp({checkReadiness:()=>db.ready(),api:router}).listen(process.argv.includes('--serve')?3006:0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const req=async(path,method='GET',body,token,expected=200)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const json=await r.json();assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(json)}`);checks++;return json.data;};
  await req('/admin/overview','GET',undefined,undefined,401);
  await req('/admin/session','POST',{username:'admin',password:'wrong'},undefined,401);
  const login=await req('/admin/session','POST',{username:'admin',password:'123456'}),token=login.accessToken;
  const mobile=await req('/auth/sessions','POST',{username:user.username,password:user.password});
  await req('/admin/overview','GET',undefined,mobile.accessToken,403);
  await req('/admin/session','POST',{username:user.username,password:user.password},undefined,401);
  await req('/auth/sessions','POST',{username:'admin',password:'123456'},undefined,400);
  const schema=await req('/admin/schema','GET',undefined,token);
  for(const [key,e] of Object.entries(schema)){
    const columns=(await db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='xland' AND table_name=$1",[e.table])).rows;
    assert.deepEqual(e.fields.map(f=>f.name).sort(),columns.map(c=>c.column_name).sort(),key+' schema completeness');checks++;
    await req('/admin/'+key,'GET',undefined,token);
  }
  const consultant=await req('/admin/consultants','POST',{name:'Chuyên viên QA',role:'Tư vấn đất nền',location:'Hà Nội',is_verified:false,is_illustrative:true,contact:{phone:'0912345678',email_contact:'qa@example.test'}},token,201);
  const publicConsultant=await req('/consultants/'+consultant.id);assert.equal(publicConsultant.name,'Chuyên viên QA');
  const source=(await req('/admin/properties','GET',undefined,token)).items[0];
  const writable=(entity,row)=>Object.fromEntries(schema[entity].fields.filter(f=>!f.readonly&&row[f.name]!==undefined).map(f=>[f.name,row[f.name]]));
  const property=await req('/admin/properties','POST',{...writable('properties',source),code:'ADMIN-QA',title:'Lô QA quản trị',consultant_id:consultant.id,price_total:'9007199254740993',approval_status:'pending',highlights:[{title:'Đường vào',description:'Đường rộng 6 m'}]},token,201);
  await req('/properties/'+property.id,'GET',undefined,undefined,404);
  await req('/admin/properties/'+property.id,'PATCH',{_version:property._version,price_total:'-1'},token,400);
  await req('/admin/properties/'+property.id,'PATCH',{_version:property._version,price_total:'1.1'},token,400);
  await req('/admin/properties/'+property.id,'PATCH',{_version:property._version,price_per_m2:'2'},token,400);
  await req('/admin/properties/'+property.id,'PATCH',{_version:property._version,area_m2:'0'},token,400);
  await req('/admin/properties/'+property.id,'PATCH',{_version:property._version,highlights:['wrong shape']},token,400);
  await req('/admin/properties/'+property.id,'PATCH',{_version:property._version,highlights:[{title:'Test',description:'Test',unexpected:true}]},token,400);
  const unsafe=await fetch(base+'/admin/properties/'+property.id,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:`{"_version":"${property._version}","price_total":9007199254740993}`});
  assert.equal(unsafe.status,400);assert.equal((await req('/admin/properties/'+property.id,'GET',undefined,token)).price_total,'9007199254740993');checks++;
  await req('/admin/properties/'+property.id,'PATCH',{_version:property._version,approval_status:'approved',status:'listed'},token);
  await req('/admin/properties/'+property.id,'PATCH',{_version:property._version,title:'Stale'},token,409);
  const visible=await req('/properties/'+property.id);assert.equal(visible.priceTotal,'9007199254740993');assert.ok(!('lat' in visible));assert.equal(visible.approvalStatus,'approved');assertWire(visible,'Property');checks++;
  const video=await req('/admin/videos','POST',{property_id:property.id,author_id:consultant.id,caption:'Video QA',published_at:new Date().toISOString(),approval_status:'approved',is_illustrative:true,media:{public_url:'https://test.supabase.co/storage/v1/object/public/test/video.mp4',storage_key:'test/video.mp4',alt_text:'Video QA',sort_order:0,is_illustrative:true,duration_seconds:8}},token,201);
  const feed=await req('/feed');assert.ok(feed.some(v=>v.id===video.id));
  assertWire(feed.find(v=>v.id===video.id),'FeedVideo');checks++;
  const a=await req('/admin/videos/'+video.id,'GET',undefined,token);
  const b=await req('/admin/media/'+video.media_id,'GET',undefined,token);
  const editedMedia=await req('/admin/media/'+b.id,'PATCH',{_version:b._version,alt_text:'Concurrent media edit'},token);
  await req('/admin/videos/'+video.id,'PATCH',{_version:a._version,caption:'Stale nested edit',media:{...writable('media',a.media),_version:a.media._version}},token,409);
  assert.equal((await req('/admin/media/'+b.id,'GET',undefined,token)).alt_text,'Concurrent media edit');checks++;
  await req('/admin/media/'+b.id,'PATCH',{_version:editedMedia._version,public_url:null},token,409);
  await req('/admin/media/'+b.id,'PATCH',{_version:editedMedia._version,public_url:''},token,409);
  const fresh=await req('/admin/videos/'+video.id,'GET',undefined,token);
  await req('/admin/videos/'+video.id,'PATCH',{_version:fresh._version,media:{alt_text:'No nested version'}},token,409);
  const currentVideo=await req('/admin/videos/'+video.id,'PATCH',{_version:fresh._version,caption:'New caption',media:{_version:fresh.media._version,alt_text:'Fresh media'}},token);
  video._version=currentVideo._version;
  const raceVideo=await req('/admin/videos/'+video.id,'GET',undefined,token);
  const race=await Promise.all([
    fetch(base+'/admin/videos/'+video.id,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({_version:raceVideo._version,caption:'Race caption',media:{_version:raceVideo.media._version,alt_text:'Video endpoint'}})}),
    fetch(base+'/admin/media/'+b.id,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({_version:raceVideo.media._version,alt_text:'Media endpoint'})}),
  ]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);checks++;
  const raceResult=await req('/admin/videos/'+video.id,'GET',undefined,token);
  assert.equal(raceResult.media.alt_text,race[0].status===200?'Video endpoint':'Media endpoint');checks++;
  video._version=raceResult._version;
  const before=(await db.pool.query('SELECT count(*) n FROM xland.property_media')).rows[0].n;
  await req('/admin/videos','POST',{property_id:property.id,author_id:consultant.id,caption:'',published_at:new Date().toISOString(),approval_status:'approved',media:{public_url:'https://example.test/v.mp4',storage_key:'test/invalid.mp4',alt_text:'QA',sort_order:1,is_illustrative:true}},token,400);
  assert.equal((await db.pool.query('SELECT count(*) n FROM xland.property_media')).rows[0].n,before,'video/media atomic rollback');
  const hidden=await req('/admin/videos/'+video.id,'PATCH',{_version:video._version,deleted_at:new Date().toISOString()},token);assert.ok(hidden.deleted_at);
  assert.ok(!(await req('/feed')).some(v=>v.id===video.id));
  const slot=await req('/admin/slots','POST',{property_id:property.id,consultant_id:consultant.id,starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),max_attendees:5,max_bookings:2,status:'open',approximate_meeting_lat:'21',approximate_meeting_lng:'105',radius_m:500,label:'Điểm hẹn QA',is_illustrative:true},token,201);
  const bookingResponse=await fetch(base+'/bookings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+mobile.accessToken,'Idempotency-Key':'admin-integration-booking-001'},body:JSON.stringify({propertyId:property.id,slotId:slot.id,attendeeCount:2,transportMode:'self_arranged',requestDocuments:true,requestLoanAdvice:false,contactName:'Khách QA',contactPhone:'0912345678'})});assert.equal(bookingResponse.status,201);const booking=(await bookingResponse.json()).data;checks++;
  const managed=await req('/admin/bookings/'+booking.id,'GET',undefined,token);assert.ok(managed.customer_phone);
  await req('/admin/bookings/'+booking.id,'PATCH',{_version:managed._version,confirmed_starts_at:new Date(Date.now()+7*86400000).toISOString()},token,400);
  await req('/admin/bookings/'+booking.id,'PATCH',{_version:managed._version,confirmed_starts_at:new Date(Date.now()+7*86400000).toISOString(),reason:'Không được đổi slot ngầm'},token,400);
  await req('/admin/bookings/'+booking.id,'PATCH',{_version:managed._version,status:'confirmed',reason:'Không được bỏ qua cọc'},token,409);
  await req('/admin/slots/'+slot.id,'PATCH',{_version:slot._version,starts_at:new Date(Date.now()+2*86400000).toISOString()},token,409);
  await req('/admin/slots/'+slot.id,'PATCH',{_version:slot._version,starts_at:slot.starts_at,ends_at:slot.ends_at,status:'closed'},token);
  assert.equal((await req('/admin/slots/'+slot.id,'GET',undefined,token)).starts_at,slot.starts_at);checks++;
  await req('/admin/bookings/'+booking.id,'PATCH',{_version:managed._version,status:'cancelled'},token,400);
  await req('/admin/bookings/'+booking.id,'PATCH',{_version:managed._version,status:'cancelled',reason:'Khách đổi kế hoạch'},token);
  assert.equal((await db.pool.query('SELECT state FROM xland.slot_reservations WHERE booking_id=$1',[booking.id])).rows[0].state,'released');
  assert.equal((await req('/bookings/'+booking.id,'GET',undefined,mobile.accessToken)).status,'cancelled');
  await req('/admin/legal','POST',{property_id:property.id,title:'Giấy chứng nhận',status:'verified',sort_order:0},token,400);
  await req('/admin/legal','POST',{property_id:property.id,title:'Thứ tự âm',status:'pending',sort_order:-1},token,400);
  const legal=await req('/admin/legal','POST',{property_id:property.id,title:'Giấy chứng nhận',status:'verified',checked_date:'2026-10-22',sort_order:0},token,201);
  assert.equal(legal.checked_date,'2026-10-22');assert.equal((await req('/admin/legal/'+legal.id,'GET',undefined,token)).checked_date,'2026-10-22');checks++;
  await req('/admin/documents','POST',{property_id:property.id,title:'Tài liệu riêng',file_type:'PDF',mime_type:'application/pdf',size_bytes:'1024',uploaded_date:'2026-10-22',storage_key:'xland-admin-media/private.pdf',access_level:'granted'},token,400);
  await req('/admin/uploads','POST',{mimeType:'text/html',size:100,privateDocument:false},token,400);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=','base64');
  const upload=async(bytes,mime='image/png',size=bytes.length,privateDocument=false)=>{
    const signed=await req('/admin/uploads','POST',{mimeType:'image/png',size,privateDocument},token);
    const put=await fetch(signed.signedUrl,{method:'PUT',headers:{'Content-Type':mime},body:bytes});assert.equal(put.status,200);return signed;
  };
  for(const [bytes,mime,size] of [[Buffer.from('text pretending to be PNG'),'image/png',25],[Buffer.alloc(0),'image/png',1],[png,'video/mp4',png.length],[png,'image/png',png.length+1]]){
    const signed=await upload(bytes,mime,size);await req('/admin/uploads/finalize','POST',{uploadId:signed.uploadId},token,400);
    assert.equal((await db.pool.query('SELECT storage_key FROM xland.admin_uploads WHERE id=$1',[signed.uploadId])).rows[0].storage_key,null);checks++;
  }
  const pending=await upload(png),pendingKey=new URL(pending.signedUrl).pathname.replace('/storage/v1/object/upload/sign/','');
  const secondAdmin=await provisionAdmin(db,'admin-second','123456');assert.equal(secondAdmin.created,true);
  const secondToken=(await req('/admin/session','POST',{username:'admin-second',password:'123456'})).accessToken;
  await req('/admin/uploads/finalize','POST',{uploadId:pending.uploadId},secondToken,400);
  await req('/admin/media','POST',{property_id:property.id,kind:'image',usage:'gallery',sort_order:10,alt_text:'Pending',storage_key:pendingKey},token,400);
  await req('/admin/media','POST',{property_id:property.id,kind:'image',usage:'gallery',sort_order:10,alt_text:'Unverified encoded URL',public_url:'https://example.supabase.co/storage/v1/object/public/%78land-admin-media/unknown.png'},token,400);
  const verified=await req('/admin/uploads/finalize','POST',{uploadId:pending.uploadId},token);
  assert.deepEqual(await req('/admin/uploads/finalize','POST',{uploadId:pending.uploadId},token),verified);checks++;
  await assert.rejects(db.pool.query('UPDATE xland.admin_uploads SET sha256=NULL WHERE id=$1',[pending.uploadId]),e=>e.code==='23514');checks++;
  await assert.rejects(db.transaction('xland_api',user.id,c=>c.query('SELECT * FROM xland.admin_uploads')),/permission denied/);checks++;
  assert.deepEqual(storage.objects.get(verified.storageKey).bytes,png);checks++;
  // The Storage double uses loopback HTTP; validate its real DB record directly
  // here without weakening the Admin API's HTTPS requirement for public URLs.
  const verifiedMedia={kind:'image',storage_key:verified.storageKey,public_url:verified.publicUrl};
  await db.transaction('xland_admin',admin.id,c=>validateStorageReferences(c,verifiedMedia));checks++;
  await assert.rejects(db.transaction('xland_admin',admin.id,c=>validateStorageReferences(c,{...verifiedMedia,kind:'video'},verifiedMedia)),e=>e.code==='INVALID_FILE');checks++;
  const privatePending=await upload(png,'image/png',png.length,true);
  const privateFile=await req('/admin/uploads/finalize','POST',{uploadId:privatePending.uploadId},token);
  assert.equal(privateFile.publicUrl,null);checks++;
  await req('/admin/documents','POST',{property_id:property.id,title:'Verified private image',file_type:'PNG',mime_type:'image/png',size_bytes:String(png.length),uploaded_date:'2026-10-22',storage_key:privateFile.storageKey,access_level:'granted'},token,201);
  await req('/admin/documents','POST',{property_id:property.id,title:'Wrong size',file_type:'PNG',mime_type:'image/png',size_bytes:'1',uploaded_date:'2026-10-22',storage_key:privateFile.storageKey,access_level:'granted'},token,400);
  await req('/admin/documents','POST',{property_id:property.id,title:'Bad key',file_type:'PDF',mime_type:'application/pdf',size_bytes:'1',uploaded_date:'2026-10-22',storage_key:'xland-admin-documents/not-owned/../unknown.pdf',access_level:'granted'},token,400);
  const eventSource=(await req('/admin/events','GET',undefined,token)).items[0];
  const event=await req('/admin/events','POST',{...writable('events',eventSource),title:'Sự kiện Admin QA'},token,201);
  assertWire(await req('/events/'+event.id),'XlandEvent');checks++;

  // Test Phase 2: GET /properties/:id/aggregate
  const agg=await req('/admin/properties/'+property.id+'/aggregate','GET',undefined,token);
  assert.equal(agg.id,property.id);
  assert.ok(Array.isArray(agg.media));
  assert.ok(Array.isArray(agg.legal_items));
  assert.ok(Array.isArray(agg.documents));
  assert.ok(Array.isArray(agg.amenities));
  assert.ok(Array.isArray(agg.slots));
  assert.ok(Array.isArray(agg.bookings));
  assert.ok(agg.legal_items.some(l=>l.id===legal.id));
  assert.ok(agg.slots.some(s=>s.id===slot.id));
  assert.ok(agg.bookings.some(b=>b.id===booking.id));
  checks++;

  // Test Phase 2: PATCH /properties/:id/media-order & DELETE /:entity/:id
  await db.pool.query("INSERT INTO xland.property_media(id,property_id,kind,usage,sort_order,storage_key,public_url,alt_text,is_illustrative) VALUES(gen_random_uuid(),$1,'image','gallery',10,'test/img1.png','https://test.supabase.co/storage/v1/object/public/test/img1.png','Img 1',true),(gen_random_uuid(),$1,'image','gallery',11,'test/img2.png','https://test.supabase.co/storage/v1/object/public/test/img2.png','Img 2',true)",[property.id]);
  const aggWithMedia=await req('/admin/properties/'+property.id+'/aggregate','GET',undefined,token);
  const m1=aggWithMedia.media.find(m=>m.alt_text==='Img 1');
  const m2=aggWithMedia.media.find(m=>m.alt_text==='Img 2');
  assert.ok(m1&&m2);
  const reorderRes=await req('/admin/properties/'+property.id+'/media-order','PATCH',{items:[{id:m1.id,sort_order:11},{id:m2.id,sort_order:10}]},token);
  assert.equal(reorderRes.updated,2);checks++;
  const aggReordered=await req('/admin/properties/'+property.id+'/aggregate','GET',undefined,token);
  assert.equal(aggReordered.media.find(m=>m.id===m1.id).sort_order,11);
  assert.equal(aggReordered.media.find(m=>m.id===m2.id).sort_order,10);checks++;

  // Delete attached media -> 409 conflict
  await req('/admin/media/'+video.media_id,'DELETE',undefined,token,409);checks++;
  // Delete standalone media -> 200
  await req('/admin/media/'+m1.id,'DELETE',undefined,token);checks++;
  // Delete legal item -> 200
  await req('/admin/legal/'+legal.id,'DELETE',undefined,token);checks++;
  // Delete property (unsupported entity) -> 405
  await req('/admin/properties/'+property.id,'DELETE',undefined,token,405);checks++;

  // Test Phase 3: Video Moderation & Review
  await db.pool.query("UPDATE xland.videos SET deleted_at = NULL, approval_status = 'pending' WHERE id = $1", [video.id]);
  const moderationList=await req('/admin/videos/moderation','GET',undefined,token);
  assert.ok(Array.isArray(moderationList));
  const targetVideo=moderationList.find(v=>v.id===video.id);
  assert.ok(targetVideo);
  assert.ok(targetVideo.author&&targetVideo.author.display_name);
  assert.ok(targetVideo.property&&targetVideo.property.code==='ADMIN-QA');
  assert.ok(targetVideo.media&&targetVideo.media.public_url);
  assert.equal(typeof targetVideo.likes_count,'number');
  assert.equal(typeof targetVideo.comments_count,'number');checks++;

  // Fast review (Reject -> Approved)
  const rejected=await req('/admin/videos/'+video.id+'/review','PATCH',{approval_status:'rejected',reason:'Chất lượng âm thanh chưa đạt'},token);
  assert.equal(rejected.approval_status,'rejected');checks++;
  const approved=await req('/admin/videos/'+video.id+'/review','PATCH',{approval_status:'approved'},token);
  assert.equal(approved.approval_status,'approved');checks++;

  // Test Phase 3: Event Aggregate & CSV Export
  await db.pool.query("INSERT INTO xland.event_registrations(id,event_id,user_id,attendee_count,contact_name,contact_phone,status,ticket_price_snapshot) VALUES(gen_random_uuid(),$1,$2,2,'Khách Test Sự Kiện','0987654321','registered',0)",[event.id,user.id]);
  const eventAgg=await req('/admin/events/'+event.id+'/aggregate','GET',undefined,token);
  assert.equal(eventAgg.id,event.id);
  assert.ok(Array.isArray(eventAgg.registrations));
  assert.equal(eventAgg.registered_attendees,2);
  assert.ok(eventAgg.registrations.some(r=>r.contact_name==='Khách Test Sự Kiện'));checks++;

  const csvRes=await fetch(base+'/admin/events/'+event.id+'/export-csv',{headers:{Authorization:'Bearer '+token}});
  assert.equal(csvRes.status,200);
  assert.ok(csvRes.headers.get('content-type')?.includes('text/csv'));
  assert.ok(csvRes.headers.get('content-disposition')?.includes('attachment; filename='));
  const buf=Buffer.from(await csvRes.arrayBuffer());
  assert.equal(buf[0],0xef,'CSV must start with UTF-8 BOM byte 1');
  assert.equal(buf[1],0xbb,'CSV must start with UTF-8 BOM byte 2');
  assert.equal(buf[2],0xbf,'CSV must start with UTF-8 BOM byte 3');
  const csvText=buf.toString('utf8');
  assert.ok(csvText.includes('Khách Test Sự Kiện'));
  assert.ok(csvText.includes('0987654321'));checks++;

  const log=await req('/admin/audit?limit=50','GET',undefined,token);assert.ok(log.items.some(r=>r.entity==='properties'));assert.ok(!JSON.stringify(log).includes('0912345678'));
  await assert.rejects(db.transaction('xland_api',user.id,c=>c.query('SELECT * FROM xland.admin_audit_log')),/permission denied/);checks++;
  await db.pool.query("DELETE FROM xland.user_roles WHERE user_id=$1 AND role='admin'",[admin.id]);
  access.clearCache();
  await req('/admin/overview','GET',undefined,token,403);
  await db.pool.query("INSERT INTO xland.user_roles(user_id,role) VALUES($1,'admin')",[admin.id]);
  access.clearCache();
  await req('/admin/session','DELETE',undefined,token);await req('/admin/overview','GET',undefined,token,401);
  await req('/admin/lookups/properties?q=QA','GET',undefined,(await req('/admin/session','POST',{username:'admin',password:'123456'})).accessToken);
  console.log(JSON.stringify({adminChecks:checks,status:'passed',schemaModules:Object.keys(schema).length,isolated:true}));
  await writeFile('.local/admin-tests/result.json',JSON.stringify({checks,status:'passed',at:new Date().toISOString()}));
  if(process.argv.includes('--serve')){router.get('/admin-qa-ready',(_req,res)=>res.json({ready:true}));console.log('Isolated QA API ready at '+base);await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
}catch(e){console.error(e);process.exitCode=1;}finally{
  if(server)await new Promise(done=>server.close(done));await storage?.close();await db?.close();
  if(databaseName&&/^xland_test_admin_[a-f0-9]{10}$/.test(databaseName))await root.query(`DROP DATABASE ${databaseName}`);
  await root.end();await local.stop();
}
process.exit(process.exitCode??0);
