// Guest viewport evidence on the owned AVD; never substitutes forms/keyboard.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const c=JSON.parse(await readFile('.local/p3-context.json','utf8'));
const installed=JSON.parse(await readFile('../xland-mobile/.local/native-installed-artifact.json','utf8'));
assert.equal(installed.artifact.sha256,c.artifact.sha256);assert.equal(installed.sourceHash,c.sourceHash);
const adb='C:/Users/Admin/AppData/Local/Android/Sdk/platform-tools/adb.exe',serial='emulator-5580';
const call=args=>execFileSync(adb,['-s',serial,...args],{windowsHide:true,timeout:10000}).toString().trim();
assert.equal(call(['shell','getprop','ro.boot.qemu.avd_name']),'Medium_Phone_API_37.0');
const before={size:call(['shell','wm','size']),density:call(['shell','wm','density']),font:call(['shell','settings','get','system','font_scale'])};
assert(/^[0-9.]+$/.test(before.font));const rows=[];let exit=0;
const driver=async args=>{
 const child=spawn(process.execPath,['tool/native_proof_control.mjs',...args,'--p3'],{cwd:resolve('../xland-mobile'),windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const timer=setTimeout(()=>child.kill(),60000);const code=await new Promise((ok,no)=>{child.once('error',no);child.once('exit',v=>ok(v??1));});clearTimeout(timer);assert.equal(code,0);return output;
};
try{
 let index=0;
 for(const width of [360,390,430])for(const scale of ['1.0','1.3']){
  const label='matrix-'+String.fromCharCode(97+index++);
  call(['shell','wm','size',width+'x860']);call(['shell','wm','density','160']);call(['shell','settings','put','system','font_scale',scale]);
  await driver(['feed']);await driver(['capture',label]);
  const filename=(await readdir(c.evidence)).filter(f=>f.startsWith('native-feed-'+label+'-')&&f.endsWith('.json')).sort().at(-1);
  assert(filename);const capture=JSON.parse(await readFile(resolve(c.evidence,filename),'utf8'));
  assert(capture.records.at(-1)?.players.some(p=>p.initialized&&!p.hasError));
  const png=await readFile(resolve(c.evidence,filename.replace('.json','.png')));
  assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),860);
  const pid=call(['shell','pidof','vn.xland.xland_mobile.cproof']);assert(/^\d+$/.test(pid));
  const errors=call(['logcat','-d','--pid='+pid,'-s','flutter:I']).split('\n').filter(l=>/A RenderFlex overflowed|EXCEPTION CAUGHT|RenderBox was not laid out/i.test(l));
  rows.push({label,width,scale,dpr:1,actualSize:call(['shell','wm','size']),actualDensity:call(['shell','wm','density']),actualFont:call(['shell','settings','get','system','font_scale']),capture:filename,layoutErrors:errors});
  await writeFile(resolve(c.evidence,'native-matrix-progress.json'),JSON.stringify({sourceHash:c.sourceHash,artifact:c.artifact,before,rows},null,2));
  assert.equal(errors.length,0);console.log(JSON.stringify({event:'native_guest_matrix_row',label,width,scale,actualVideoInitialized:true}));
 }
}catch{exit=1;console.error('Native guest matrix failed; inspect captured error evidence, no success relabel');}finally{
 call(['shell','wm','size',before.size.match(/Override size:\s*(\d+x\d+)/)?.[1]??'reset']);
 call(['shell','wm','density',before.density.match(/Override density:\s*(\d+)/)?.[1]??'reset']);
 call(['shell','settings','put','system','font_scale',before.font]);
 await writeFile(resolve(c.evidence,'native-matrix-result.json'),JSON.stringify({exit,sourceHash:c.sourceHash,artifact:c.artifact,before,rows,restored:{size:call(['shell','wm','size']),density:call(['shell','wm','density']),font:call(['shell','settings','get','system','font_scale'])},scope:'Actual guest feed only; manual visual review required; not owner/forms/keyboard E10 completion'},null,2));
}
process.exitCode=exit;
