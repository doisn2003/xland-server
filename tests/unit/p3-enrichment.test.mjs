import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256} from '../../scripts/p3-enrichment/inventory.mjs';
import {validateDataset,materialize,classify,same,safeAssetPath,verifyAsset,storageHeaders,validateWriteWindow,storageConfig} from '../../scripts/p3-enrichment/pipeline.mjs';
import {repairBundle,planRepair} from '../../scripts/p3-enrichment/repair-highlights.mjs';
const legacyManifest=JSON.parse(await readFile(new URL('../../fixtures/p3-enrichment/manifest.json',import.meta.url),'utf8'));
const legacyDataset=JSON.parse(await readFile(new URL('../../fixtures/p3-enrichment/dataset.json',import.meta.url),'utf8'));
const manifest=JSON.parse(await readFile(new URL('../../fixtures/p3-enrichment/revisions/v1.1-highlights/manifest.json',import.meta.url),'utf8'));
const dataset=JSON.parse(await readFile(new URL('../../fixtures/p3-enrichment/revisions/v1.1-highlights/dataset.json',import.meta.url),'utf8'));
const reseal=d=>({...manifest,datasetSha256:sha256(JSON.stringify(d))});
test('bundle keeps exact money, unverified personas and complete owned relations',()=>{
  assert.equal(validateDataset(manifest,dataset),true);
  const props=dataset.rows.filter(r=>r.table==='properties');
  assert.equal(props.length,16);
  for(const r of props)assert.equal(BigInt(r.values.area_m2),BigInt(r.values.frontage_m)*BigInt(r.values.depth_m));
  assert.equal(new Set(dataset.rows.filter(r=>r.table==='video_comments').map(r=>r.values.author_id)).size,30);
  assert.equal(dataset.rows.filter(r=>r.table==='video_comments').length,120);
  assert.equal(dataset.rows.some(r=>r.table==='user_contacts'||r.table==='auth_sessions'),false);
});
test('tampering, fake verified identities and duplicate ownership are rejected',()=>{
  const d=structuredClone(dataset);d.rows[0].values.status='active';
  assert.throws(()=>validateDataset(reseal(d),d),/disabled/);
  const p=structuredClone(dataset);p.rows.find(r=>r.table==='user_profiles').values.is_verified=true;
  assert.throws(()=>validateDataset(reseal(p),p),/verified/);
  const dup=structuredClone(dataset);dup.rows.push(dup.rows[0]);
  assert.throws(()=>validateDataset(reseal(dup),dup),/Duplicate/);
  assert.throws(()=>validateDataset({...manifest,datasetSha256:'wrong'},dataset),/digest/);
  assert.throws(()=>safeAssetPath('../.env'),/escaped/);
});
test('pre-existing deterministic ID is never adopted without private ownership journal',async()=>{
  const r=dataset.rows[0],fake={query:async sql=>({rows:sql.includes('xland.user_identities ')?[{...r.values}]:[]})};
  await assert.rejects(classify(fake,{rows:[r],adopted:[]},manifest,'https://test.invalid',null),/not journal-owned/);
});
test('journaled replay compares database numeric/date/json values without overwriting drift',async()=>{
  const p=dataset.rows.find(r=>r.table==='properties'),values=materialize(p.values,manifest,'https://test.invalid');
  const found={...values,area_m2:values.area_m2+'.000000',updated_at:new Date(values.updated_at)};
  const fake={query:async()=>({rows:[found]})},journal={entries:[{kind:'insert',table:p.table,key:p.key}]};
  const replay=await classify(fake,{rows:[p],adopted:[]},manifest,'https://test.invalid',journal);
  assert.equal(replay[0].kind,'unchanged');
  found.title='Changed by another writer';
  await assert.rejects(classify(fake,{rows:[p],adopted:[]},manifest,'https://test.invalid',journal),/changed outside/);
  assert.ok(same({a:[{x:1,y:'2.000'}]},{a:[{y:2,x:'1'}]}));
});
test('adopted media requires original null URL preimage',async()=>{
  const r=dataset.adopted[0],fake={query:async()=>({rows:[{id:r.key.id,...r.expected,public_url:'https://someone.invalid/real.png'}]})};
  await assert.rejects(classify(fake,{rows:[],adopted:[r]},manifest,'https://test.invalid',null),/preimage changed/);
});
test('media verification rejects bytes and verifies actual seek Range response',async()=>{
  const originalFetch=globalThis.fetch,bytes=Buffer.from('mock-video-bytes-0123456789');
  const a={key:'test',mimeType:'video/mp4',sizeBytes:bytes.length,sha256:sha256(bytes)};
  try {
    globalThis.fetch=async(_url,opts)=>opts?.headers?.Range?
      new Response(bytes.subarray(bytes.length-2),{status:206,headers:{'Content-Range':`bytes ${bytes.length-2}-${bytes.length-1}/${bytes.length}`}}):
      new Response(bytes,{headers:{'Content-Type':'video/mp4'}});
    assert.equal((await verifyAsset('https://test.invalid/v.mp4',a)).range.status,206);
    globalThis.fetch=async()=>new Response('corrupt',{headers:{'Content-Type':'video/mp4'}});
    await assert.rejects(verifyAsset('https://test.invalid/v.mp4',a),/hash mismatch/);
  }finally{globalThis.fetch=originalFetch;}
});
test('opaque secret keys use apikey; only legacy JWT keys get a Bearer header',()=>{
  assert.deepEqual(storageHeaders('sb_secret_test-only'),{apikey:'sb_secret_test-only'});
  assert.deepEqual(storageHeaders('legacy-jwt-test-only'),{apikey:'legacy-jwt-test-only',Authorization:'Bearer legacy-jwt-test-only'});
});
test('write coordination rejects invalid expiry, string consent and expired windows',()=>{
  const now=Date.UTC(2026,9,19),w={owner:manifest.owner,targetFingerprint:manifest.targetFingerprint,manifestSha256:'test-hash',noConcurrentSchemaOrIdentityWrites:true,expiresAt:new Date(now+60000).toISOString()};
  assert.equal(validateWriteWindow(w,'test-hash',now),true);
  for(const expiresAt of [undefined,'not a date',new Date(now).toISOString(),new Date(now-1).toISOString()])assert.throws(()=>validateWriteWindow({...w,expiresAt},'test-hash',now),/stale/);
  assert.throws(()=>validateWriteWindow({...w,noConcurrentSchemaOrIdentityWrites:'true'},'test-hash',now),/mismatched/);
  assert.throws(()=>validateWriteWindow(w,'other-hash',now),/mismatched/);
});
test('known API base path normalizes only after exact DB project validation',async()=>{
  const env={DATABASE_URL:'postgresql://postgres:test-only@db.project123.supabase.co/postgres',SUPABASE_SECRET_KEY:'sb_secret_test-only'};
  for(const suffix of ['/','/rest/v1','/rest/v1/','/storage/v1','/storage/v1/'])assert.equal((await storageConfig({...env,SUPABASE_URL:'https://project123.supabase.co'+suffix})).url,'https://project123.supabase.co');
  for(const url of ['https://other123.supabase.co/rest/v1','https://project123.supabase.co/arbitrary','https://project123.supabase.co:8888/','https://project123.supabase.co/?secret=test'])await assert.rejects(storageConfig({...env,SUPABASE_URL:url}),/differs/);
});
test('C4 rejects legacy string highlights and wrong object field names',()=>{
  assert.throws(()=>validateDataset(legacyManifest,legacyDataset),/Highlight/);
  const d=structuredClone(dataset);d.rows.find(r=>r.table==='properties').values.highlights=[{id:'wrong',label:'wrong',value:'wrong'}];
  assert.throws(()=>validateDataset(reseal(d),d),/Highlight/);
  const m=structuredClone(dataset);m.adopted.find(r=>r.table==='events').values.media[0].durationSeconds='8';
  assert.throws(()=>validateDataset(reseal(m),m),/MediaAsset/);
});
test('repair preview/replay is exactly sixteen owned fields and refuses drift/unowned after-values',async()=>{
  const b=await repairBundle(),rows=b.repair.changes.map(r=>({id:r.key.id,highlights:structuredClone(r.expected.highlights)}));
  const c={query:async()=>({rows})};
  const first=await planRepair(c,b);assert.equal(first.filter(r=>r.kind==='update').length,16);
  for(const row of rows)row.highlights=structuredClone(b.repair.changes.find(r=>r.key.id===row.id).values.highlights);
  await assert.rejects(planRepair(c,b),/lacks own repair journal/);
  const journal={status:'committed',repairSha256:b.repairSha256};
  assert.equal((await planRepair(c,b,journal)).filter(r=>r.kind!=='unchanged').length,0);
  rows[0].highlights=[{title:'External edit',description:'Must preserve'}];
  await assert.rejects(planRepair(c,b,journal),/precondition/);
});
