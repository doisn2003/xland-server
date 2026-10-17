import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
const run=JSON.parse(await readFile('.local/closeout-run.json','utf8'));
assert(resolve(run.evidence).startsWith(resolve('../brain/logs/agent-c/evidence/P2-CLOSEOUT')+sep),'C closeout evidence namespace required');
const preview=JSON.parse(await readFile('.local/preview.json','utf8'));
assert.equal(preview.demoMedia,true);assert.equal(preview.demoScenario,'normal');assert.equal(preview.fingerprint,'03d6c297d77a1029');
const get=async path=>{const r=await fetch('http://127.0.0.1:3001'+path,{headers:{Origin:'http://127.0.0.1:5555'},signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:5555');return r.json();};
await get('/health/ready');
const properties=(await get('/api/v1/properties')).data,events=(await get('/api/v1/events')).data,clubs=(await get('/api/v1/clubs')).data;
const now=new Date(),end=new Date(Date.now()+30*86400000);const date=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const property=properties.find(p=>p.code==='XL-028');assert(property);const slots=(await get(`/api/v1/properties/${property.id}/availability?fromDate=${date(now)}&toDate=${date(end)}`)).data;
const media=await fetch('http://127.0.0.1:5560/demo-video.mp4',{headers:{Origin:'http://127.0.0.1:5555',Range:'bytes=0-31'},signal:AbortSignal.timeout(3000)});assert.equal(media.status,206);assert.equal(media.headers.get('Content-Type'),'video/mp4');assert.equal(media.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:5555');await media.arrayBuffer();
const sdk=process.env.XLAND_FLUTTER_SDK??'C:/Users/Admin/AppData/Local/XLandTools/flutter-3.47.5';
const output=await new Promise((ok,fail)=>{const child=spawn(resolve(sdk,'bin/cache/dart-sdk/bin/dart.exe'),['run','tool/closeout_env_probe.dart'],{cwd:resolve('../xland-mobile'),windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',()=>{});const timer=setTimeout(()=>child.kill(),30000);child.once('error',fail);child.once('exit',code=>{clearTimeout(timer);if(code!==0)fail(Error('Typed feed probe failed'));else ok(JSON.parse(output.trim()));});});
const result={timestamp:new Date().toISOString(),environment:'supabase_mock',fingerprint:preview.fingerprint,preview:{pid:preview.pid,flutterPid:preview.flutterPid,mode:'demo-media/normal',api:'http://127.0.0.1:3001/api/v1',web:'http://127.0.0.1:5555',media:'http://127.0.0.1:5560',coordinatedRestart:'User confirmed preview unused; owned restart plus final typed-overlay fix restart before READY; no migration/seed'},readiness:200,cors:true,mediaRange:206,properties:properties.map(p=>({id:p.id,code:p.code,title:p.title,consultantId:p.consultantId})),events:events.map(e=>({id:e.id,status:e.status,startsAt:e.startsAt,timeZone:e.timeZone,remainingSlots:e.remainingSlots,ticketPriceVnd:e.ticketPriceVnd})),clubs:clubs.map(c=>({id:c.id,title:c.title})),slots:slots.map(s=>({id:s.id,propertyId:s.propertyId,consultantId:s.consultantId,startsAt:s.startsAt,endsAt:s.endsAt,timeZone:s.timeZone,maxAttendees:s.maxAttendees,isAvailable:s.isAvailable})),typedFeed:output,feedPlaybackVerified:false};
const evidenceFile=resolve(run.evidence,'env-ready-'+Date.now()+'.json');
await writeFile(evidenceFile,JSON.stringify(result,null,2),{flag:'wx'});
await writeFile('../brain/logs/agent-c/P2_CLOSEOUT_ENV_READY.md',`# C → B/A: closeout ENV READY — 17/10/2026

**READY để B bắt đầu B-02.** Chủ dự án xác nhận không dùng preview; C đã dừng đúng owned supervisor và restart có phối hợp; thêm lượt áp bản sửa typed overlay trước khi chốt READY với '--demo-media', không migrate/seed. API/Web/media readiness đã kiểm tra; đây chưa phải playback trong feed Pass.

- App **http://127.0.0.1:5555**, API **http://127.0.0.1:3001/api/v1**, media **http://127.0.0.1:5560/demo-video.mp4**. Mode **demo-media/normal**, supervisor PID${preview.pid}, Flutter PID${preview.flutterPid}. CORS5555 và range206/video/mp4 Pass.
- Real typed repository→HTTP/Supabase→demo overlay trả **${output.videoCount}videos/${output.distinctPropertyCount}properties**, giữ video/property/media IDs. Raw API media null vẫn đúng baseline; URL demo chỉ được overlay khi composition bật flag. Không ghi DB/fixtures hoặc đưa DB URI vào app.
- Start/restart có phối hợp: từ server 'node scripts/preview.mjs stop' rồi 'node scripts/preview.mjs start --demo-media'; status 'node scripts/preview.mjs status'; stop chỉ owned pipe/PID. Không kill theo port. Giữ listener đã Ready để tránh hai bên restart liên tục.
- Media helper foreground 'node scripts/media-demo-provider.mjs'; status HEAD /demo-video.mp4 hoặc GET /manifest.json; Ctrl+C dừng đúng terminal helper. C-owned helper5560 đã chạy và được tái dùng sau xác minh nguồn, không start trùng/kill process khác.
- Errors: composition '--demo-media-scenario=expired'→410 hoặc 'unavailable'→503 (restart có phối hợp); '/expired','/broken' cũng kiểm trực tiếp; offline chỉ dừng đúng media helper, không API. B kiểm pause/tab/route/background/dispose và source errors trong **chính feed**, không dùng standalone probe5556 thay thế.
- Credentials demo chỉ private '.local/supabase-demo-login.json'; tài khoản closeout riêng sẽ ở '.local/closeout-accounts.json' sau API proof, không trong log/client/source.
- Canonical event open **${events.find(e=>e.status==='open')?.id??'none'}**, club **${clubs[0]?.id??'none'}**; 'ev-001' không hợp lệ. Slot metadata từ API: ${slots.map(s=>s.id+' / '+s.startsAt+' / '+s.timeZone+' / maxAttendees='+s.maxAttendees).join('; ')||'không có slot trong khoảng30ngày — hiển thị unavailable'}.

Evidence timestamp ${result.timestamp}: '${evidenceFile}'; source/config W4 đã A Pass, C-4 locked giữ nguyên. Package2.11.1 đã có; không còn chờ C thêm player. B sở hữu player/presentation; **feed playback chưa xác nhận**. Native/API proof và input matrix tiếp tục độc lập; Phase3 đóng.
`,{encoding:'utf8'});
console.log(JSON.stringify({event:'closeout_env_ready',pid:preview.pid,mode:'demo-media/normal',videos:output.videoCount,properties:output.distinctPropertyCount,readiness:200,feedPlaybackVerified:false}));
