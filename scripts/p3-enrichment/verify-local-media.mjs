import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {serverRoot,evidenceRoot,sha256} from './inventory.mjs';
const exec=promisify(execFile),root=resolve(serverRoot,'fixtures/p3-enrichment');
const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
const encoder=resolve(process.env.FFMPEG_BIN||resolve(serverRoot,'.local/w4-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'));
const results=[];
for(const a of manifest.assets) {
  const path=resolve(root,a.file),bytes=await readFile(path);
  if(bytes.length!==a.sizeBytes||sha256(bytes)!==a.sha256)throw new Error('Hash/bytes mismatch');
  let duration=null,seekFrameMd5=null;
  if(a.mimeType==='video/mp4') {
    const decoded=await exec(encoder,['-nostdin','-hide_banner','-i',path,'-f','null','-'],{windowsHide:true,timeout:120000,maxBuffer:1000000});
    if(!decoded.stderr.includes('720x1280')||!decoded.stderr.includes('h264 (Constrained Baseline)'))throw new Error('Unexpected video codec/size');
    const d=decoded.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);duration=Number(d[1])*3600+Number(d[2])*60+Number(d[3]);
    if(duration!==a.durationSeconds)throw new Error('Duration mismatch');
    const moov=bytes.indexOf(Buffer.from('moov')),mdat=bytes.indexOf(Buffer.from('mdat'));
    if(moov<0||mdat<0||moov>mdat)throw new Error('MP4 is not faststart');
    const seek=await exec(encoder,['-nostdin','-v','error','-ss','4','-i',path,'-frames:v','1','-an','-f','md5','-'],{windowsHide:true,timeout:30000});
    seekFrameMd5=seek.stdout.trim();if(!/^MD5=[a-f0-9]{32}$/.test(seekFrameMd5))throw new Error('Seek frame not decoded');
  }else if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('PNG signature mismatch');
  results.push({key:a.key,mimeType:a.mimeType,sizeBytes:bytes.length,sha256:a.sha256,durationSeconds:duration,seekFrameMd5});
}
const result={owner:manifest.owner,timestamp:new Date().toISOString(),files:results.length,totalBytes:manifest.totalBytes,
  pngs:results.filter(r=>r.mimeType==='image/png').length,decodedVideos:results.filter(r=>r.durationSeconds!==null).length,results};
await writeFile(resolve(evidenceRoot,'local-media-verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({files:result.files,pngs:result.pngs,decodedVideos:result.decodedVideos,totalBytes:result.totalBytes}));
