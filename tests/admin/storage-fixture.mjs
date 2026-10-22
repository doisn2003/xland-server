import {createServer} from 'node:http';
import {once} from 'node:events';

// Local HTTP double for the Storage service only. Admin routes, permissions,
// upload verification, byte inspection and PostgreSQL transactions stay real.
export async function storageFixture(){
  const objects=new Map();
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://test').pathname.replace('/storage/v1','');
    if(req.method==='POST'&&path.startsWith('/object/upload/sign/')){
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:path+'?token=qa'}));return;
    }
    const key=path.replace(/^\/object\/(?:authenticated\/|upload\/sign\/)?/,'');
    if(req.method==='GET'){
      const object=objects.get(key);if(!object){res.writeHead(404);res.end('{}');return;}
      res.setHeader('Content-Type',object.mime);res.end(object.bytes);return;
    }
    if(req.method==='POST'||req.method==='PUT'){
      if(objects.has(key)){res.writeHead(409);res.end('{}');return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      objects.set(key,{bytes:Buffer.concat(chunks),mime:req.headers['content-type']});res.end('{}');return;
    }
    res.writeHead(404);res.end('{}');
  }).listen(0,'127.0.0.1');await once(server,'listening');
  return {env:{SUPABASE_URL:`http://127.0.0.1:${server.address().port}`,SUPABASE_SECRET_KEY:'sb_secret_qa_fixture'},objects,close:()=>new Promise(resolve=>server.close(resolve))};
}
