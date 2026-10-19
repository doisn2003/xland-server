// A dedicated private local cluster/port. Never reads current DATABASE_URL.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {localPostgres} from '../local-postgres.mjs';
import {migrate} from '../../src/repositories/migrations.ts';
import {runtime} from '../../src/runtime.ts';
import {classify,applyEntries,undoEntries,materialize,same} from './pipeline.mjs';
import {serverRoot,evidenceRoot} from './inventory.mjs';
const manifest=JSON.parse(await readFile(resolve(serverRoot,'fixtures/p3-enrichment/manifest.json'),'utf8'));
const dataset=JSON.parse(await readFile(resolve(serverRoot,'fixtures/p3-enrichment/dataset.json'),'utf8'));
const snapshot=JSON.parse(await readFile(resolve(evidenceRoot,'content-before.json'),'utf8'));
const inventory=JSON.parse(await readFile(resolve(evidenceRoot,'inventory.json'),'utf8'));
const encode=v=>v&&typeof v==='object'?JSON.stringify(v):v;
let local,pool;
try {
  local=await localPostgres({directory:resolve(serverRoot,'.local/p3-enrichment/test-cluster'),port:55448});
  const admin=new pg.Pool({connectionString:local.rootUrl});
  const name='xland_test_p3_enrichment_'+randomBytes(6).toString('hex');
  try{await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);}finally{await admin.end();}
  const u=new URL(local.rootUrl);u.pathname='/'+name;pool=new pg.Pool({connectionString:u.toString(),max:1});
  await migrate(pool);
  const c=await pool.connect();
  try {
    const insert=async(table,values)=>{
      const columns=(await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='xland' AND table_name=$1 AND is_generated='NEVER'",[table])).rows.map(r=>r.column_name);
      const keys=Object.keys(values).filter(k=>columns.includes(k));
      await c.query(`INSERT INTO xland.${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>encode(values[k])));
    };
    const legacyPeople=[...new Set([...snapshot.consultants.map(c=>c.id),...snapshot.videos.map(v=>v.author_id)])];
    for(const id of legacyPeople){await insert('user_identities',{id,username_normalized:'legacy-'+id.slice(-12),password_hash:'disabled-test-only',status:'disabled'});await insert('user_profiles',{id,display_name:'Legacy fixture',is_illustrative:true});}
    for(const row of snapshot.consultants)await insert('consultants',row);
    for(const row of inventory.locations.filter(r=>r.kind==='province'))await insert('geo_locations',row);
    for(const row of inventory.locations.filter(r=>r.kind==='district'))await insert('geo_locations',row);
    for(const table of ['properties','property_media','videos','events','clubs'])for(const row of snapshot[table])await insert(table,row);
    const outsider=randomUUID();await insert('video_comments',{id:outsider,video_id:snapshot.videos[0].id,author_id:legacyPeople[0],body:'Outside manifest — preserve'});
    const before=(await c.query('SELECT * FROM xland.video_comments WHERE id=$1',[outsider])).rows[0];
    await c.query('BEGIN');
    const plan=await classify(c,dataset,manifest,'https://test-project.supabase.co',null,true);
    const entries=plan.filter(r=>r.kind!=='unchanged');
    for(const e of entries.filter(r=>r.table==='user_identities'))e.values.password_hash='disabled-random-test-'+randomBytes(48).toString('hex');
    await applyEntries(c,entries);await c.query('COMMIT');
    await c.query('BEGIN');
    const replay=await classify(c,dataset,manifest,'https://test-project.supabase.co',{entries},true);
    assert.equal(replay.filter(r=>r.kind!=='unchanged').length,0);await c.query('COMMIT');
    const counts=(await c.query(`SELECT (SELECT count(*)::int FROM xland.properties) properties,(SELECT count(*)::int FROM xland.consultants) consultants,(SELECT count(*)::int FROM xland.videos) videos,(SELECT count(*)::int FROM xland.video_comments) comments,(SELECT count(*)::int FROM xland.property_media WHERE public_url IS NOT NULL) media_urls,(SELECT count(*)::int FROM xland.user_identities WHERE status='active') active_identities`)).rows[0];
    assert.equal(counts.properties,20);assert.equal(counts.consultants,8);assert.equal(counts.videos,96);assert.equal(counts.comments,121);assert.equal(counts.media_urls,118);assert.equal(counts.active_identities,0);
    for(const r of dataset.rows.filter(r=>r.table==='videos')) {
      const found=(await c.query('SELECT count(*)::int n FROM xland.video_comments WHERE video_id=$1',[r.key.id])).rows[0];assert.equal(found.n,10);
    }
    const app=await runtime({NODE_ENV:'test',TEST_DATABASE_URL:u.toString(),TEST_DATABASE_ENVIRONMENT:'test',CURSOR_SECRET:randomBytes(32).toString('hex'),PUBLIC_BASE_URL:'https://test-project.supabase.co'});
    const server=app.app.listen(0,'127.0.0.1');
    await new Promise(r=>server.once('listening',r));
    let apiProperties=0,apiVideos=0,apiComments=0,apiConsultants=0;
    try {
      const base=`http://127.0.0.1:${server.address().port}/api/v1`;
      const get=async path=>{const r=await fetch(base+path);assert.equal(r.status,200);return r.json();};
      const list=await get('/properties?limit=50');assert.equal(list.meta.total,20);
      for(const r of dataset.rows.filter(r=>r.table==='properties')) {
        const {data:p}=await get('/properties/'+r.key.id);assert.equal(p.id,r.key.id);assert.ok(same(p.priceTotal,r.values.price_total));assert.ok(p.media[0].url.startsWith('https://test-project.supabase.co/storage/'));apiProperties++;
      }
      for(const r of dataset.rows.filter(r=>r.table==='videos')) {
        const {data:v}=await get('/videos/'+r.key.id),{data:comments}=await get('/videos/'+r.key.id+'/comments?limit=50');
        assert.equal(v.propertyId,r.values.property_id);assert.equal(v.author.id,r.values.author_id);assert.equal(v.commentCount,10);assert.equal(comments.length,10);assert.ok(comments.every(c=>!c.canDelete));assert.equal(v.media.durationSeconds,8);apiVideos++;apiComments+=comments.length;
      }
      for(const r of dataset.rows.filter(r=>r.table==='consultants')) {
        const {data:d}=await get('/consultants/'+r.key.id);assert.equal(d.isVerified,false);assert.equal(d.followerCount,0);assert.equal(d.videoCount,r.values.video_count);apiConsultants++;
      }
      const {data:events}=await get('/events?limit=50'),{data:clubs}=await get('/clubs?limit=50');
      assert.ok(events.every(e=>e.media.length===1));assert.ok(clubs.every(e=>e.media.length===1));
    }finally{await new Promise(r=>server.close(r));await app.close();}
    // A concurrent edit must stop a rollback; the transaction restores all earlier undo steps.
    const drift=entries.find(r=>r.table==='video_comments');
    await c.query('UPDATE xland.video_comments SET body=$2 WHERE id=$1',[drift.key.id,'Edited by another writer']);
    await c.query('BEGIN');await assert.rejects(undoEntries(c,entries),/Rollback conflict/);await c.query('ROLLBACK');
    await c.query('UPDATE xland.video_comments SET body=$2 WHERE id=$1',[drift.key.id,drift.values.body]);
    await c.query('BEGIN');await undoEntries(c,entries);await c.query('COMMIT');
    assert.ok(same((await c.query('SELECT * FROM xland.video_comments WHERE id=$1',[outsider])).rows[0],before));
    const after=(await c.query('SELECT count(*)::int properties FROM xland.properties')).rows[0];assert.equal(after.properties,4);
    for(const r of dataset.adopted){const found=(await c.query(`SELECT * FROM xland.${r.table} WHERE id=$1`,[r.key.id])).rows[0];assert.ok(same(Object.fromEntries(Object.keys(r.expected).map(k=>[k,found[k]])),r.expected));}
    const result={environment:'isolated-local-postgresql',port:55448,sharedDatabaseWrites:0,firstApply:{insert:entries.filter(e=>e.kind==='insert').length,update:entries.filter(e=>e.kind==='update').length},secondApplyChanges:0,counts,apiReadback:{properties:apiProperties,videos:apiVideos,comments:apiComments,consultants:apiConsultants,normalRuntime:true,guest:true,demoOverlay:false},rollbackRestoredProperties:4,outsiderPreserved:true,concurrentEditRollbackRejected:true,timestamp:new Date().toISOString()};
    await writeFile(resolve(evidenceRoot,'isolated-integration.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
    // Ensure every wire placeholder can be resolved without the demo overlay.
    assert.ok(materialize(dataset.rows,manifest,'https://test-project.supabase.co'));
  }finally{c.release();}
}catch(e){console.error(JSON.stringify({status:'FAIL',code:e.code||'ASSERTION',message:e.code?'Private local integration failure; no target DB access':e.message}));process.exitCode=1;}
finally{await pool?.end();await local?.stop();}
process.exit(process.exitCode||0);
