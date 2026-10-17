import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {parse} from 'dotenv';
import {resolve} from 'node:path';
import {Database} from '../src/repositories/database.js';
import {databaseTarget} from '../src/config/database-target.js';
import {evidenceDirectory} from '../src/config/evidence.js';
type Context={runLabel:string;rows:Array<{id:string;mediaId:string;sort:number}>};
const env=parse(await readFile('.env.supabase-mock','utf8')),target=databaseTarget(env,false);assert.equal(target.fingerprint,'03d6c297d77a1029');
const accounts=JSON.parse(await readFile('.local/closeout-accounts.json','utf8')) as {accounts:Array<{id:string}>};
let context:Context;try{context=JSON.parse(await readFile('.local/feed-benchmark-context.json','utf8')) as Context;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Preserve private fixture context');context={runLabel:'c-closeout02-feed-'+randomUUID().slice(0,8),rows:Array.from({length:60},(_,i)=>({id:randomUUID(),mediaId:randomUUID(),sort:10000+i}))};await writeFile('.local/feed-benchmark-context.json',JSON.stringify(context),{flag:'wx',mode:0o600});}
assert(context.runLabel.startsWith('c-closeout02-feed-'));assert.equal(context.rows.length,60);
const db=new Database(target.connectionString,1);let child:ReturnType<typeof spawn>|undefined;let phase='additive-labelled-fixture';
try{
 // Fixture provisioning only: runtime below always uses normal xland_api RLS.
 const c=await db.pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE xland_seed');
  const properties=(await c.query("SELECT id FROM xland.properties WHERE status='listed' ORDER BY id")).rows;assert(properties.length>=2);
  const oldest=(await c.query('SELECT min(published_at) oldest FROM xland.videos')).rows[0].oldest as Date;
  for(const [i,row]of context.rows.entries()){
   const property=properties[i%properties.length]!.id;
   await c.query("INSERT INTO xland.property_media(id,property_id,kind,usage,public_url,thumbnail_url,alt_text,duration_seconds,sort_order,is_illustrative) VALUES($1,$2,'video','feed',null,null,$3,4,$4,true) ON CONFLICT DO NOTHING",[row.mediaId,property,'XLAND DEMO ONLY '+context.runLabel,row.sort]);
   await c.query("INSERT INTO xland.videos(id,property_id,author_id,media_id,caption,published_at,approval_status,view_count,is_illustrative) VALUES($1,$2,$3,$4,$5,$6,'approved',0,true) ON CONFLICT DO NOTHING",[row.id,property,accounts.accounts[0]!.id,row.mediaId,'XLAND DEMO ONLY '+context.runLabel+' '+i,new Date(oldest.getTime()-3600000-i*1000)]);
   const check=(await c.query('SELECT author_id,caption,media_id FROM xland.videos WHERE id=$1',[row.id])).rows[0];assert.equal(check.author_id,accounts.accounts[0]!.id);assert.equal(check.media_id,row.mediaId);assert.equal(check.caption,'XLAND DEMO ONLY '+context.runLabel+' '+i);
  }await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 phase='owned-api-start';child=spawn(process.execPath,['--import','tsx','scripts/closeout-restart-api.ts'],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 const apiChild=child;
 const port=await new Promise<number>((ok,fail)=>{const timer=setTimeout(()=>{apiChild.kill();fail(Error('Probe startup timeout'));},20000);apiChild.once('error',e=>{clearTimeout(timer);fail(e);});apiChild.once('message',m=>{clearTimeout(timer);ok((m as {port:number}).port);});});
 phase='actual-dart-transport';const sdk=process.env.XLAND_FLUTTER_SDK??'C:/Users/Admin/AppData/Local/XLandTools/flutter-3.47.5';
 const output=await new Promise<string>((ok,fail)=>{const dart=spawn(resolve(sdk,'bin/cache/dart-sdk/bin/dart.exe'),['run','tool/feed_timing_probe.dart','http://127.0.0.1:'+port+'/api/v1'],{cwd:resolve('../xland-mobile'),windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';dart.stdout.on('data',b=>text+=b);dart.stderr.on('data',()=>{});const timer=setTimeout(()=>{dart.kill();fail(Error('Timing probe timeout'));},180000);dart.once('error',fail);dart.once('exit',code=>{clearTimeout(timer);if(code===0)ok(text);else fail(Error('Actual transport failed'));});});
 const result=JSON.parse(output.trim().split('\n').at(-1)!);assert.equal(result.transportTimeoutSeconds,15);
 await writeFile((await evidenceDirectory())+'/feed-performance-supabase.json',JSON.stringify({...result,environment:target.environment,fingerprint:target.fingerprint,runLabel:context.runLabel,addedMockVideoIds:context.rows.map(r=>r.id),additiveOnly:true,originalRowsOverwritten:false,syntheticSource:'Project-created DEMO metadata; existing local procedural MP4 overlay, no property footage',apiRuntimeRole:'xland_api',noCrossUserCache:true,previewRestarted:false,before:{source:'Agent A RV-P2-005/feed-timings.json',limit10Ms:10053,limit20Ms:17689},localQueryCount:{before:'1+7*N',after:8,transactionSetupExcluded:true}},null,2));
 console.log(JSON.stringify({event:'feed_performance_samples',summaries:result.summaries,timeoutSeconds:15,addedMockRows:60,previewRestarted:false,slaClaim:false}));
}catch(e){console.error(JSON.stringify({event:'feed_performance_failed',phase,code:(e as {code?:string}).code??'CHECK_FAILED'}));process.exitCode=1;}finally{
 if(child){const owned=child;await new Promise<void>(ok=>{if(owned.exitCode!==null){ok();return;}const timer=setTimeout(()=>{owned.kill();ok();},15000);owned.once('exit',()=>{clearTimeout(timer);ok();});if(owned.connected)owned.send({action:'stop'});else owned.kill();});}await db.close();
}
