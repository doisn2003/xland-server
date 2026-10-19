// Build original demo video from the project's AI-generated artwork and tone.
// Leaves the earlier w4 acceptance fixture intact.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const server=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(server,'demo-assets/p3-report-v1');
const ffmpeg=resolve(server,'.local/w4-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const assets=resolve(server,'../brain/assets/p3-report-v1');
await mkdir(output,{recursive:true});
const variants=[['countryside','countryside-portrait.png'],['coastal','coastal-landscape.png']];
const records=[];
for(const [name,input] of variants){
 const source=resolve(assets,input),dest=resolve(output,name+'.mp4');
 const args=['-hide_banner','-loglevel','error','-y','-loop','1','-framerate','24','-i',source,
  '-f','lavfi','-i','sine=frequency=440:sample_rate=44100',
  '-vf',"scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,zoompan=z='min(zoom+0.00025,1.045)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=720x1280:fps=24,format=yuv420p",
  '-af','volume=0.025,afade=t=in:d=0.4,afade=t=out:st=7.5:d=0.5',
  '-t','8','-c:v','libx264','-profile:v','baseline','-level','3.1','-crf','23','-preset','fast',
  '-c:a','aac','-b:a','64k','-movflags','+faststart',dest];
 execFileSync(ffmpeg,args,{windowsHide:true,timeout:120000});
 await copyFile(source,resolve(output,name+'.png'));
 for(const ext of ['mp4','png']){
  const bytes=await readFile(resolve(output,name+'.'+ext));
  records.push({file:name+'.'+ext,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),source:input});
 }
}
await writeFile(resolve(output,'manifest.json'),JSON.stringify({version:1,date:'2026-10-18',isIllustrative:true,
 notice:'AI-generated fictional scenery animated with a slow zoom; not actual property footage. Original synthetic 440Hz tone for playback/mute testing. Not a property/legal/identity representation.',
 sourceArtworkManifest:'brain/assets/p3-report-v1/manifest.json',video:{codec:'H.264 baseline',pixelFormat:'yuv420p',width:720,height:1280,fps:24,durationSeconds:8,audio:'AAC 44.1kHz, original quiet synthetic tone'},files:records},null,2));
console.log(JSON.stringify({generated:records.map(r=>({file:r.file,bytes:r.bytes,sha256:r.sha256}))}));
