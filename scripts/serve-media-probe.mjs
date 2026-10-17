import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../xland-mobile/build/w4-media-probe');
const mime={'.html':'text/html','.js':'application/javascript','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));const suffix=relative(root,file);
  if(suffix.startsWith('..')||isAbsolute(suffix)){res.writeHead(403).end();return;}
  const bytes=await readFile(file);res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(req.method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(404).end();}
});
server.once('error',()=>{console.error('Media probe port occupied or build unavailable; no process stopped');process.exitCode=1;});
server.listen(5556,'127.0.0.1',()=>console.log(JSON.stringify({event:'media_probe_static_ready',pid:process.pid,url:'http://127.0.0.1:5556',scope:'diagnostic only; not feed acceptance'})));
const stop=()=>{server.closeIdleConnections();server.close(()=>process.exit(0));};process.once('SIGINT',stop);process.once('SIGTERM',stop);
