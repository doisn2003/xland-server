import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const c=JSON.parse(await readFile('.local/p3-context.json','utf8'));
const installed=JSON.parse(await readFile('../xland-mobile/.local/native-installed-artifact.json','utf8'));
assert.equal(installed.sourceHash,c.sourceHash);assert.equal(installed.artifact.sha256,c.artifact.sha256);
assert.equal(createHash('sha256').update(await readFile(c.artifact.path)).digest('hex'),c.artifact.sha256);
const dir=resolve(c.evidence,'guest-restart');await mkdir(dir,{recursive:true});
const adb='C:/Users/Admin/AppData/Local/Android/Sdk/platform-tools/adb.exe',pkg='vn.xland.xland_mobile.cproof';
const call=(args,input)=>execFileSync(adb,['-s','emulator-5580',...args],{input,windowsHide:true,timeout:15000,maxBuffer:16*1024*1024});
assert.equal(call(['shell','getprop','ro.boot.qemu.avd_name']).toString().trim(),'Medium_Phone_API_37.0');
const pause=ms=>new Promise(r=>setTimeout(r,ms));let runKey='',savedInput=null,phase='start',exit=0,baselineRestored=false;
const records=()=>call(['logcat','-d','-s','flutter:I']).toString().split('\n').flatMap(line=>{const p=line.indexOf('XLAND_C02 ');if(p<0)return[];try{const r=JSON.parse(line.slice(p+10));return r.runKey===runKey?[r]:[];}catch{return[];}});
const until=async test=>{const end=Date.now()+45000;while(Date.now()<end){if(test())return;await pause(300);}throw Error('Player state deadline');};
const xml=()=>{
 for(let i=0;i<3;i++){
  call(['shell','rm','-f','/sdcard/xland-a-guest.xml']);
  try{call(['shell','uiautomator','dump','/sdcard/xland-a-guest.xml']);return call(['shell','cat','/sdcard/xland-a-guest.xml']).toString();}catch{/* startup can still be loading offstage; retry observation only */}
 }
 throw Error('UI did not become idle');
};
const node=(tree,text)=>[...tree.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]).find(s=>{const v=s.match(/content-desc="([^"]*)"/)?.[1]??s.match(/text="([^"]*)"/)?.[1]??'';return v.startsWith(text)||v.startsWith('Tab '+text);});
const tap=async n=>{assert(n);const b=n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert(b);call(['shell','input','tap',String(Math.round((+b[1]+ +b[3])/2)),String(Math.round((+b[2]+ +b[4])/2))]);await pause(900);};
const launch=async()=>{runKey=randomUUID();call(['shell','am','force-stop',pkg]);call(['shell',`run-as ${pkg} sh -c 'mkdir -p files; cat > files/c02-input.json'`],Buffer.from(JSON.stringify({mode:'feed',runKey})));call(['shell','am','start','-W','-n',pkg+'/vn.xland.xland_mobile.MainActivity']);await until(()=>records().at(-1)?.players?.[0]?.initialized);};
const openSettings=async()=>{
 if(records().at(-1)?.players?.[0]?.playing){call(['shell','input','tap','120','750']);await pause(500);}
 await tap(node(xml(),'Tôi'));assert(xml().includes('Chưa đăng nhập'));await tap(node(xml(),'Cài đặt ứng dụng'));
};
const setPreferences=async(autoplay,muted)=>{
 for(const [text,value]of [['Tự động phát video',autoplay],['Tắt tiếng mặc định',muted]]){
  const n=node(xml(),text);assert(n);if(n.includes('checked="true"')!==value)await tap(n);
 }
 const tree=xml();assert.equal(node(tree,'Tự động phát video').includes('checked="true"'),autoplay);assert.equal(node(tree,'Tắt tiếng mặc định').includes('checked="true"'),muted);return tree;
};
const proof={sourceHash:c.sourceHash,artifact:c.artifact,device:'emulator-5580',remoteWrites:false};
try{
 try{savedInput=call(['exec-out','run-as',pkg,'cat','files/c02-input.json']);}catch{/* no prior private handoff */}
 await launch();phase='initial-autoplay';await until(()=>records().at(-1)?.players?.[0]?.playing);
 await openSettings();phase='save-false-true';
 await writeFile(resolve(dir,'saved.xml'),await setPreferences(false,true));
 phase='force-stop-cold-restart';await launch();
 await until(()=>records().filter(r=>r.players?.[0]?.initialized).length>=3);
 const paused=records().filter(r=>r.players?.[0]?.initialized).slice(-3);assert(paused.length>=3);
 for(const r of paused){const p=r.players[0];assert(p.initialized&&!p.playing&&p.positionMs===0&&p.volume===0);}
 await writeFile(resolve(dir,'cold-start.json'),JSON.stringify({runKey,records:paused,...proof},null,2));
 await writeFile(resolve(dir,'cold-start.png'),call(['exec-out','screencap','-p']));
 phase='reopen-settings';await openSettings();const reopened=xml();
 assert(node(reopened,'Tự động phát video').includes('checked="false"'));assert(node(reopened,'Tắt tiếng mặc định').includes('checked="true"'));
 await writeFile(resolve(dir,'reopened.xml'),reopened);
 phase='restore-baseline';await writeFile(resolve(dir,'restored.xml'),await setPreferences(true,false));baselineRestored=true;
 await launch();await until(()=>{const p=records().at(-1)?.players?.[0];return p?.playing&&p.volume===1&&p.positionMs>0;});
 await writeFile(resolve(dir,'restored-playing.json'),JSON.stringify({runKey,records:records().slice(-3),...proof},null,2));
 phase='manual-pause-tab-route';call(['shell','input','tap','120','750']);
 await until(()=>records().at(-1)?.players?.[0]?.initialized&&!records().at(-1)?.players?.[0]?.playing);
 const pausedPosition=records().at(-1).players[0].positionMs;
 await tap(node(xml(),'Khám phá'));await tap(node(xml(),'Trang chủ'));await pause(1200);
 let current=records().at(-1).players[0];assert(!current.playing&&current.positionMs===pausedPosition);
 await writeFile(resolve(dir,'pause-tab-return.json'),JSON.stringify({runKey,pausedPosition,records:records().slice(-3),...proof},null,2));
 await tap(node(xml(),'Xem chi tiết'));call(['shell','input','keyevent','4']);await pause(1500);
 current=records().at(-1).players[0];assert(!current.playing&&current.positionMs===pausedPosition);
 await writeFile(resolve(dir,'pause-route-return.json'),JSON.stringify({runKey,pausedPosition,records:records().slice(-3),...proof},null,2));
 console.log(JSON.stringify({event:'report_guest_cold_restart_pass',sourceHash:c.sourceHash,persisted:[false,true],coldPausedAtZero:true,restored:[true,false]}));
}catch{exit=1;console.error(JSON.stringify({event:'report_guest_restart_failed',phase,details:'No shared service or database was changed'}));}
finally{
 call(['shell','am','force-stop',pkg]);if(savedInput)call(['shell',`run-as ${pkg} sh -c 'cat > files/c02-input.json'`],savedInput);
 else call(['shell','run-as',pkg,'rm','-f','files/c02-input.json']);
 await writeFile(resolve(dir,'result.json'),JSON.stringify({exit,phase,baselineRestored,...proof},null,2));
}
process.exitCode=exit;
