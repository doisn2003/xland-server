import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=new Map([
 ['/demo-video.mp4',{bytes:readFileSync(resolve(root,'demo-assets/w4/xland-synthetic.mp4')),mime:'video/mp4'}],
 ['/demo-poster.png',{bytes:readFileSync(resolve(root,'demo-assets/w4/xland-synthetic.png')),mime:'image/png'}],
]);
export const mediaProvenance=JSON.parse(readFileSync(resolve(root,'demo-assets/w4/manifest.json'),'utf8'));
export function mediaDemoServer({now=()=>Date.now()}={}){return createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');res.setHeader('X-Xland-Demo','synthetic-project-created');
 const allowed=['http://127.0.0.1:5555','http://localhost:5555','http://127.0.0.1:5556'];
 if(req.headers.origin){if(!allowed.includes(req.headers.origin)){res.writeHead(403).end();return;}res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Expose-Headers','Content-Length,Content-Range,Accept-Ranges,X-Xland-Demo');}
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Range');res.writeHead(204).end();return;}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
 if(url.pathname==='/expired'){res.writeHead(410).end();return;}if(url.pathname==='/broken'){res.writeHead(503).end();return;}
 if(url.searchParams.has('expires')){const expiry=Number(url.searchParams.get('expires'));if(!Number.isSafeInteger(expiry)||expiry>Math.floor(now()/1000)+300){res.writeHead(400).end();return;}if(expiry<=Math.floor(now()/1000)){res.writeHead(410).end();return;}}
 if(url.pathname==='/manifest.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(mediaProvenance));return;}
 const file=files.get(url.pathname);if(!file){res.writeHead(404).end();return;}
 let start=0,end=file.bytes.length-1,status=200;res.setHeader('Content-Type',file.mime);res.setHeader('Accept-Ranges','bytes');
 if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||(!match[1]&&!match[2])){res.setHeader('Content-Range',`bytes */${file.bytes.length}`);res.writeHead(416).end();return;}
 if(!match[1]){const suffix=Number(match[2]);start=Math.max(0,file.bytes.length-suffix);if(suffix===0)start=file.bytes.length;}else{start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),end);}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=file.bytes.length){res.setHeader('Content-Range',`bytes */${file.bytes.length}`);res.writeHead(416).end();return;}status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${file.bytes.length}`);}
 res.setHeader('Content-Length',end-start+1);res.writeHead(status);res.end(req.method==='HEAD'?undefined:file.bytes.subarray(start,end+1));
});}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=mediaDemoServer();server.once('error',()=>{console.error(JSON.stringify({event:'media_demo_start_failed',reason:'Check port ownership; no service was stopped'}));process.exitCode=1;});
 server.listen(5560,'127.0.0.1',()=>console.log(JSON.stringify({event:'media_demo_ready',pid:process.pid,video:'http://127.0.0.1:5560/demo-video.mp4'})));
 const stop=()=>{server.closeIdleConnections();server.close(()=>process.exit(0));};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
