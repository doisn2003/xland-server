import {readFile, writeFile, mkdir, copyFile, access} from 'node:fs/promises';
import {resolve, relative} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {serverRoot, evidenceRoot, sha256, fingerprintExpected} from './inventory.mjs';
import {propertyHighlights,validateC4NestedJson} from './nested-json.mjs';

const exec = promisify(execFile);
export const fixtureRoot = resolve(serverRoot, 'fixtures/p3-enrichment');
export const owner = 'xland-p3-enrichment-v1';
export const stableId = key => {
  const h = sha256(owner + ':' + key);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
};
const pngSize = bytes => ({width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});
const jsonWrite = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');

export async function prepare() {
  try {
    const journal=JSON.parse(await readFile(resolve(serverRoot,'.local/p3-enrichment/journal.json'),'utf8'));
    if(journal.status==='committed')throw new Error('v1 already committed and immutable; use repair-highlights.mjs prepare for reviewed v1.1');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const assetsRoot = resolve(fixtureRoot, 'assets');
  await mkdir(assetsRoot, {recursive:true});
  const original = JSON.parse(await readFile(resolve(serverRoot,'../brain/assets/p3-report-v1/manifest.json'),'utf8'));
  const receipts = JSON.parse(await readFile(resolve(fixtureRoot,'generation-receipts.json'),'utf8'));
  const assets = [];
  for (const a of original.assets) {
    const src = resolve(serverRoot,'../brain/assets/p3-report-v1',a.file);
    const bytes = await readFile(src);
    if (sha256(bytes) !== a.sha256) throw new Error('Original artwork hash mismatch');
    await copyFile(src, resolve(assetsRoot,a.file));
    assets.push({key:a.file.replace('.png',''),file:'assets/'+a.file,mimeType:'image/png',
      sizeBytes:bytes.length,sha256:sha256(bytes),...pngSize(bytes),durationSeconds:null,
      role:a.file.includes('consultant')?'avatar':a.file.includes('coffee')?'community':'scenery',
      provenance:{kind:'ai-generated',source:a.source,model:null,modelDisclosure:'Exact model not exposed by built-in tool',generatedDate:'2026-10-18',promptFile:'brain/assets/p3-report-v1/prompts.json',
        sourceManifest:'brain/assets/p3-report-v1/manifest.json',license:'project AI-generated asset; no third-party photograph',
        depictsRealListedProperty:false,depictsRealEmployee:false,isIllustrative:true}});
  }
  for (const r of receipts) {
    const bytes = await readFile(resolve(assetsRoot,r.key+'.png'));
    assets.push({key:r.key,file:'assets/'+r.key+'.png',mimeType:'image/png',sizeBytes:bytes.length,
      sha256:sha256(bytes),...pngSize(bytes),durationSeconds:null,role:r.key.startsWith('fictional-advisor')?'avatar':'scenery',
      provenance:{kind:'ai-generated',source:'OpenAI built-in image_gen',model:null,modelDisclosure:'Exact model not exposed by built-in tool',generatedDate:'2026-10-19',prompt:r.prompt,
        license:'project AI-generated asset; no third-party photograph',depictsRealListedProperty:false,
        depictsRealEmployee:false,isIllustrative:true}});
  }
  const encoder = resolve(process.env.FFMPEG_BIN || resolve(serverRoot,'.local/w4-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'));
  const scenes = assets.filter(a=>a.role==='scenery');
  const encoderVersion = (await exec(encoder,['-version'],{windowsHide:true})).stdout.split('\n')[0].trim();
  for (const a of scenes) {
    const name = a.key+'-panzoom.mp4', path = resolve(assetsRoot,name);
    const oldName = a.key==='countryside-portrait'?'countryside':a.key==='coastal-landscape'?'coastal':null;
    if (oldName) await copyFile(resolve(serverRoot,'demo-assets/p3-report-v1',oldName+'.mp4'),path);
    else {
      let exists = true;
      try {await access(path);} catch {exists=false;}
      if (!exists) await exec(encoder,['-nostdin','-hide_banner','-loglevel','error','-y','-loop','1','-framerate','24',
        '-i',resolve(fixtureRoot,a.file),'-vf',"scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,zoompan=z='min(zoom+0.00025,1.045)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=720x1280:fps=24,format=yuv420p",
        '-t','8','-an','-c:v','libx264','-profile:v','baseline','-level','3.1','-crf','25','-preset','fast','-movflags','+faststart',path],
        {windowsHide:true,timeout:120000});
    }
    const bytes = await readFile(path);
    assets.push({key:a.key+'-clip',file:'assets/'+name,mimeType:'video/mp4',sizeBytes:bytes.length,sha256:sha256(bytes),
      width:720,height:1280,durationSeconds:8,role:'clip',thumbnailAssetKey:a.key,
      provenance:{kind:'ai-still-panzoom',sourceAssetKey:a.key,sourceSha256:a.sha256,
        sourceManifest:oldName?'xland-server/demo-assets/p3-report-v1/manifest.json':null,
        generator:'scripts/p3-enrichment/prepare.mjs',encoder:encoderVersion,codec:'H.264 baseline / yuv420p / 24fps / faststart',
        license:a.provenance.license,actualSiteFootage:false,legalEvidence:false,isIllustrative:true}});
  }
  for (const a of assets) a.storagePath=`${owner}/${a.role}/${a.sha256.slice(0,16)}-${a.file.split('/').at(-1)}`;
  const existing = JSON.parse(await readFile(resolve(evidenceRoot,'content-before.json'),'utf8'));
  const rows=[];
  const add=(table,key,values,extra={})=>rows.push({table,key,values,...extra});
  const names=['Lan Phương','Quang Quân','Thu Hà','Đức Huy','Minh Thảo','Thanh Bình','Yến Nhi','Gia Hân','Hoàng Long','Mai Chi','Tuấn Kiệt','Ngọc Anh','Hải Nam','Thu Trang','Khánh Linh','Quốc Bảo','Bích Ngọc','Anh Khoa','Phương Dung','Tùng Lâm','Thanh Trúc','Nhật Minh','Bảo Châu','Minh Tâm','Hồng Hạnh','Duy Khánh','Kim Ngân','Hữu Phước','Thảo Nguyên','An Nhiên'];
  const avatars=assets.filter(a=>a.role==='avatar'&&a.key!=='consultant-fictional');
  const personIds=names.map((_,i)=>stableId('persona:'+i));
  const locations=['Hà Nội','Hưng Yên','Bắc Ninh','Đà Nẵng'];
  for(const [i,name] of names.entries()) {
    const id=personIds[i],consultant=i<7;
    add('user_identities',{id},{id,username_normalized:`p3-persona-${String(i+1).padStart(2,'0')}`,password_hash:'$random-disabled-at-apply$',status:'disabled'});
    add('user_profiles',{id},{id,display_name:name,avatar_url:i<7?{$asset:avatars[i].key}:null,is_verified:false,
      public_role:consultant?'Tư vấn đất nền':i<12?'Chia sẻ thông tin khu vực':null,is_illustrative:true});
    if(consultant) add('consultants',{id},{id,name,role:'Tư vấn đất nền',location:locations[i%4],is_verified:false,
      avatar_url:{$asset:avatars[i].key},cover_url:{$asset:scenes[i%scenes.length].key},next_available_slot:null,
      video_count:0,follower_count:0,rating:null,is_illustrative:true});
    // No contact/settings/roles/auth provider/session rows: these personas cannot log in.
  }
  const bases=existing.properties;
  const titles=['Lô vườn bên đường làng','Đất ở cạnh khu dân cư','Lô góc gần vườn cây','Đất vườn thoáng phía đồi'];
  for(let i=0;i<16;i++) {
    const b=bases[i%4],id=stableId('property:'+i),front=String(5+i%4),depth=String(18+i%5),area=String(Number(front)*Number(depth));
    add('properties',{id},{id,code:`XL-P3-${String(i+1).padStart(3,'0')}`,title:`${titles[Math.floor(i/4)]} ${b.province}`,
      province:b.province,province_code:b.province_code,district:b.district,district_code:b.district_code,catalog_version:b.catalog_version,
      region:b.region,category:i>=12?'agricultural':'residential',price_total:(BigInt(area)*BigInt(9000000+(i%4)*2500000)).toString(),
      area_m2:area,frontage_m:front,depth_m:depth,road_width_m:String(4+i%3),direction:['east','south','southeast','north'][i%4],
      land_type:i>=12?'agricultural':'residential',status:'listed',status_badge:'standard',approval_status:'approved',consultant_id:personIds[i%7],
      highlights:propertyHighlights({district:b.district,frontage_m:front,depth_m:depth}),
      approximate_lat:b.region==='central'?16.05:20.99+i%3*0.05,approximate_lng:b.region==='central'?108.19:105.55+i%3*0.12,
      approximate_radius_m:3000,is_illustrative:true,updated_at:`2026-10-${String(18-i%4).padStart(2,'0')}T03:00:00Z`});
    const candidates=scenes.filter(a=>b.region==='central'?a.key.startsWith('central')||a.key.includes('coastal'):!a.key.startsWith('central')&&!a.key.includes('coastal'));
    const scene=candidates[Math.floor(i/4)%candidates.length];
    add('property_media',{id:stableId('gallery:'+i)},{id:stableId('gallery:'+i),property_id:id,kind:'image',usage:'gallery',
      storage_key:{$path:scene.key},public_url:{$asset:scene.key},thumbnail_url:{$asset:scene.key},alt_text:`Không gian tham khảo tại ${b.district}`,
      duration_seconds:null,sort_order:0,is_illustrative:true});
  }
  const clips=assets.filter(a=>a.role==='clip');
  const newProperties=rows.filter(r=>r.table==='properties');
  for(const [i,clip] of clips.entries()) {
    // Match coastal/northern source to the property's broad region; no exact plot claims.
    const central=clip.key.startsWith('central')||clip.key.includes('coastal');
    const candidates=newProperties.filter(r=>central?r.values.region==='central':r.values.region==='north');
    const property=candidates[i%candidates.length],id=stableId('video:'+i),mid=stableId('feed-media:'+i),author=personIds[i%12];
    add('property_media',{id:mid},{id:mid,property_id:property.key.id,kind:'video',usage:'feed',storage_key:{$path:clip.key},
      public_url:{$asset:clip.key},thumbnail_url:{$asset:clip.thumbnailAssetKey},duration_seconds:8,sort_order:i,
      alt_text:'Không gian xanh và đường tiếp cận khu vực',is_illustrative:true});
    add('videos',{id},{id,property_id:property.key.id,author_id:author,media_id:mid,
      caption:`${property.values.title}. ${property.values.area_m2} m², mặt tiền ${property.values.frontage_m} m. Cùng trao đổi về đường tiếp cận và nhu cầu sử dụng.`,
      published_at:`2026-10-18T${String(8+i).padStart(2,'0')}:00:00Z`,approval_status:'approved',view_count:'0',is_illustrative:true});
  }
  const videoRows=rows.filter(r=>r.table==='videos');
  const questions=[
    p=>`Khu vực ${p.district} có tuyến xe buýt nào thuận tiện để tới xem không?`,
    p=>`Lô ${p.area_m2} m² có thể bố trí khoảng sân nhỏ phía trước được nhỉ.`,
    p=>`Mặt tiền ${p.frontage_m} m phù hợp nhu cầu gia đình mình, mong được xem kích thước thực tế.`,
    ()=>`Mình muốn hỏi thêm về đường đi vào khu dân cư, nên tới xem vào thời điểm nào?`,
    ()=>`Phần đường tiếp cận nên kiểm tra cả lúc trời mưa để hiểu điều kiện sử dụng.`,
    ()=>`Có thể gửi thêm thông tin tiện ích sinh hoạt quanh khu vực qua tư vấn được không?`,
    ()=>`Mình ưu tiên chỗ yên tĩnh, có cây xanh và dễ đi lại cuối tuần.`,
    ()=>`Nên hẹn lịch xem và đối chiếu hồ sơ trước khi quyết định, cảm ơn bài chia sẻ.`,
    p=>`Diện tích ${p.area_m2} m² là phần tham khảo, mình sẽ cần đo lại khi đi xem.`,
    ()=>`Mong có thêm thông tin về khoảng cách tới chợ và trường học trong khu vực.`
  ];
  for(let i=0;i<120;i++) {
    const v=videoRows[i%videoRows.length],p=newProperties.find(r=>r.key.id===v.values.property_id).values,id=stableId('comment:'+i);
    add('video_comments',{id},{id,video_id:v.key.id,author_id:personIds[(i+3)%30],body:questions[Math.floor(i/videoRows.length)%10](p),
      created_at:new Date(Date.UTC(2026,9,19,1,Math.floor(i/60),i%60)).toISOString()});
  }
  // New consultant counters reflect only actual authored videos. No invented reviews/follows/views.
  for(const r of rows.filter(r=>r.table==='consultants')) r.values.video_count=videoRows.filter(v=>v.values.author_id===r.key.id).length;
  const adopted=[];
  for(const m of existing.property_media) {
    const p=bases.find(p=>p.id===m.property_id);
    const scene=p.region==='central'?'coastal-landscape':'countryside-portrait';
    const asset=m.kind==='video'?scene+'-clip':scene;
    adopted.push({table:'property_media',key:{id:m.id},expected:{property_id:m.property_id,public_url:m.public_url,thumbnail_url:m.thumbnail_url,
      storage_key:m.storage_key,duration_seconds:m.duration_seconds,alt_text:m.alt_text,is_illustrative:m.is_illustrative},
      values:{storage_key:{$path:asset},public_url:{$asset:asset},thumbnail_url:{$asset:scene},duration_seconds:m.kind==='video'?8:null,
        alt_text:m.kind==='video'?'Không gian và đường tiếp cận khu vực':'Phong cảnh khu vực tham khảo'}});
  }
  const community=assets.find(a=>a.role==='community');
  for(const table of ['events','clubs']) for(const e of existing[table]) adopted.push({table,key:{id:e.id},expected:{media:e.media},
    values:{media:[{id:stableId(table+':'+e.id),kind:'image',url:{$asset:community.key},thumbnailUrl:{$asset:community.key},
      durationSeconds:null,altText:'Không gian gặp gỡ cộng đồng',isIllustrative:true}]}});
  const oldConsultant=existing.consultants[0];
  adopted.push({table:'consultants',key:{id:oldConsultant.id},expected:{avatar_url:oldConsultant.avatar_url,cover_url:oldConsultant.cover_url},
    values:{avatar_url:{$asset:'consultant-fictional'},cover_url:{$asset:'countryside-landscape'}}});
  const dataset={owner,targetFingerprint:fingerprintExpected,rows,adopted};
  validateC4NestedJson(dataset);
  const manifest={version:1,owner,targetFingerprint:fingerprintExpected,bucket:'public-media',prefix:owner,
    provenanceNotice:'Synthetic mock content; no verified legal, personal identity or actual site footage claims.',
    datasetSha256:sha256(JSON.stringify(dataset)),assets,totalBytes:assets.reduce((n,a)=>n+a.sizeBytes,0),
    counts:{newProperties:16,newConsultants:7,newAuthors:12,newPersonas:30,newComments:120,
      uniqueSceneryImages:scenes.length,uniqueAvatars:assets.filter(a=>a.role==='avatar').length,uniqueClips:clips.length,
      preservedExistingProperties:bases.length,preservedExistingVideos:existing.videos.length,newRows:rows.length,adoptedRows:adopted.length},
    gaps:{sceneryImageTarget:60,uniqueSceneryImages:scenes.length,shortfall:Math.max(0,60-scenes.length),
      note:'v1 retains 12 distinct scenery source images; reusing one source across mock records is not counted as a new photo. Expand with more approved original assets in a later version.'}};
  await jsonWrite(resolve(fixtureRoot,'dataset.json'),dataset);
  await jsonWrite(resolve(fixtureRoot,'manifest.json'),manifest);
  console.log(JSON.stringify({owner,counts:manifest.counts,totalBytes:manifest.totalBytes,gaps:manifest.gaps,
    files:assets.map(a=>relative(fixtureRoot,resolve(fixtureRoot,a.file)))}));
}
if(process.argv[1]?.endsWith('prepare.mjs')) prepare().catch(e=>{console.error(e.message);process.exitCode=1;});
