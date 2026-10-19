import {readFile, writeFile, mkdir, appendFile, open} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import argon2 from 'argon2';
import {serverRoot,evidenceRoot,sha256,targetEnvironment,poolFor,fingerprintExpected} from './inventory.mjs';
import {validateC4NestedJson} from './nested-json.mjs';

const fixtureRoot=resolve(serverRoot,'fixtures/p3-enrichment');
const privateRoot=resolve(serverRoot,'.local/p3-enrichment');
const journalFile=resolve(privateRoot,'journal.json');
const storageJournal=resolve(privateRoot,'storage-journal.jsonl');
const writeWindow=resolve(serverRoot,'../brain/logs/agent-database/WRITE_WINDOW.json');
const owner='xland-p3-enrichment-v1';
const tables=new Set(['user_identities','user_profiles','consultants','properties','property_media','videos','video_comments','events','clubs']);
const adoptFields={property_media:['storage_key','public_url','thumbnail_url','duration_seconds','alt_text'],events:['media'],clubs:['media'],consultants:['avatar_url','cover_url']};
const identifier=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw new Error('Unsafe identifier');return s;};
const jsonWrite=async(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const canonical=value=>{
  if(value instanceof Date)return value.toISOString();
  if(typeof value==='number')return '#'+String(value);
  if(typeof value==='string'&&/^-?\d+(\.\d+)?$/.test(value))return '#'+value.replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
  if(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value)))return new Date(value).toISOString();
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
};
export const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const sqlValue=value=>value&&typeof value==='object'?JSON.stringify(value):value;
export const subset=(row,expected)=>Object.fromEntries(Object.keys(expected).map(k=>[k,row[k]]));
export function safeAssetPath(file) {
  const path=resolve(fixtureRoot,file),rel=relative(fixtureRoot,path);
  if(isAbsolute(rel)||rel.startsWith('..')||!rel.startsWith('assets'))throw new Error('Asset escaped fixture root');
  return path;
}
export function materialize(value,manifest,url) {
  if(Array.isArray(value))return value.map(v=>materialize(v,manifest,url));
  if(value&&typeof value==='object') {
    if('$asset' in value||'$path' in value) {
      const a=manifest.assets.find(a=>a.key===(value.$asset||value.$path));
      if(!a)throw new Error('Unknown asset reference');
      if('$path' in value)return manifest.bucket+'/'+a.storagePath;
      return `${url}/storage/v1/object/public/${manifest.bucket}/${a.storagePath}`;
    }
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,materialize(v,manifest,url)]));
  }
  return value;
}
export function validateDataset(manifest,dataset,options={}) {
  if(manifest.owner!==owner||dataset.owner!==owner||manifest.prefix!==owner||manifest.bucket!=='public-media'||
      manifest.targetFingerprint!==fingerprintExpected||dataset.targetFingerprint!==fingerprintExpected)throw new Error('Manifest owner/target mismatch');
  if(sha256(JSON.stringify(dataset))!==manifest.datasetSha256)throw new Error('Dataset digest mismatch');
  const keys=new Set();
  for(const r of [...dataset.rows,...dataset.adopted]) {
    if(!tables.has(r.table)||!r.key.id||Object.keys(r.key).length!==1)throw new Error('Unapproved table/key');
    identifier(r.table);Object.keys(r.values).forEach(identifier);
    const key=r.table+':'+r.key.id;
    if(keys.has(key))throw new Error('Duplicate manifest row');keys.add(key);
  }
  for(const r of dataset.adopted)if(Object.keys(r.values).some(k=>!adoptFields[r.table]?.includes(k)))throw new Error('Unapproved adopted column');
  for(const r of dataset.rows.filter(r=>r.table==='user_identities'))if(r.values.status!=='disabled'||r.values.password_hash!=='$random-disabled-at-apply$')throw new Error('Synthetic login must remain disabled');
  for(const r of dataset.rows.filter(r=>['consultants','user_profiles'].includes(r.table)))if(r.values.is_verified!==false)throw new Error('Synthetic identity cannot be verified');
  if(dataset.rows.some(r=>r.table==='properties'&&(!r.values.is_illustrative||r.values.lat||r.values.lng)))throw new Error('Synthetic exact location not allowed');
  const ids=table=>new Set(dataset.rows.filter(r=>r.table===table).map(r=>r.key.id));
  const people=ids('user_profiles'),properties=ids('properties'),videos=ids('videos');
  for(const r of dataset.rows) {
    const v=r.values;
    if(r.table==='consultants'&&!people.has(v.id))throw new Error('Orphan consultant');
    if(r.table==='videos'&&(!people.has(v.author_id)||!properties.has(v.property_id)))throw new Error('Orphan video');
    if(r.table==='video_comments'&&(!people.has(v.author_id)||!videos.has(v.video_id)))throw new Error('Orphan comment');
  }
  const assetKeys=new Set(),hashes=new Set();
  for(const a of manifest.assets) {
    if(assetKeys.has(a.key)||hashes.has(a.sha256))throw new Error('Duplicate asset key/bytes');assetKeys.add(a.key);hashes.add(a.sha256);
    if(!a.storagePath.startsWith(owner+'/')||a.storagePath.includes('..')||!['image/png','video/mp4'].includes(a.mimeType)||a.sizeBytes>15000000||!a.provenance?.license)throw new Error('Unapproved asset');
    safeAssetPath(a.file);
  }
  validateC4NestedJson(dataset,options);
  return true;
}
async function loadBundle() {
  const manifest=JSON.parse(await readFile(resolve(fixtureRoot,'manifest.json'),'utf8'));
  const dataset=JSON.parse(await readFile(resolve(fixtureRoot,'dataset.json'),'utf8'));
  const committedBase=await readJournal();
  validateDataset(manifest,dataset,{allowLegacyHighlights:committedBase?.status==='committed'&&committedBase.manifestSha256===sha256(JSON.stringify(manifest))});
  for(const a of manifest.assets) {
    const bytes=await readFile(safeAssetPath(a.file));
    if(bytes.length!==a.sizeBytes||sha256(bytes)!==a.sha256)throw new Error('Asset bytes/hash mismatch');
  }
  return {manifest,dataset,manifestSha256:sha256(JSON.stringify(manifest))};
}
async function readJournal() {try{return JSON.parse(await readFile(journalFile,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export function validateWriteWindow(w,manifestSha256,now=Date.now()) {
  const expires=typeof w.expiresAt==='string'?Date.parse(w.expiresAt):NaN;
  if(w.owner!==owner||w.targetFingerprint!==fingerprintExpected||w.manifestSha256!==manifestSha256||w.noConcurrentSchemaOrIdentityWrites!==true||!Number.isFinite(expires)||expires<=now)throw new Error('Write window is stale or mismatched');
  return true;
}
async function requireWindow(manifestSha256) {
  const w=JSON.parse(await readFile(writeWindow,'utf8').catch(()=>{throw new Error('A schema/identity write window missing; see REQUESTS.md');}));
  validateWriteWindow(w,manifestSha256);
}
export async function storageConfig(env) {
  const key=env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY;
  if(!env.SUPABASE_URL||!key)throw new Error('Storage credentials missing; configure .env.p3-enrichment privately');
  const url=new URL(env.SUPABASE_URL),db=new URL(env.DATABASE_URL);
  const ref=db.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1]||decodeURIComponent(db.username).match(/\.([a-z0-9]+)$/)?.[1];
  const acceptedPaths=new Set(['/','/rest/v1','/rest/v1/','/storage/v1','/storage/v1/']);
  // Dashboard may supply a REST/Storage API base. Normalize only known service
  // paths after the exact DB project check; never guess a project or follow redirects.
  if(url.protocol!=='https:'||!ref||url.hostname!==ref+'.supabase.co'||!acceptedPaths.has(url.pathname)||url.port||url.search||url.hash||url.username||url.password)throw new Error('Storage project/base URL differs from current database target');
  if(!key.startsWith('sb_secret_')) {
    let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));}catch{throw new Error('Invalid server Storage credential');}
    if(claims.role!=='service_role'||claims.ref!==ref)throw new Error('Storage key role/project mismatch');
  }
  return {url:url.origin,key};
}
export const storageHeaders=key=>key.startsWith('sb_secret_')?{apikey:key}:{apikey:key,Authorization:'Bearer '+key};
async function request(config,path,options={}) {
  const response=await fetch(config.url+'/storage/v1'+path,{...options,redirect:'error',signal:AbortSignal.timeout(45000),
    headers:{...storageHeaders(config.key),...options.headers}});
  return response;
}
export async function verifyAsset(url,a) {
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error('Public asset HTTP status '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(response.headers.get('content-type')?.split(';')[0]!==a.mimeType||bytes.length!==a.sizeBytes||sha256(bytes)!==a.sha256)throw new Error('Public asset MIME/bytes/hash mismatch');
  let range=null;
  if(a.mimeType==='video/mp4') {
    const start=Math.min(4096,a.sizeBytes-2),end=Math.min(start+1023,a.sizeBytes-1);
    const part=await fetch(url,{headers:{Range:`bytes=${start}-${end}`},redirect:'error',signal:AbortSignal.timeout(20000)});
    const partBytes=Buffer.from(await part.arrayBuffer());
    if(part.status!==206||part.headers.get('content-range')!==`bytes ${start}-${end}/${a.sizeBytes}`||!partBytes.equals(bytes.subarray(start,end+1)))throw new Error('Video byte-range verification failed');
    range={status:206,start,end};
  }
  return {key:a.key,status:response.status,mimeType:a.mimeType,bytes:bytes.length,sha256:a.sha256,range};
}
async function upload({manifest,manifestSha256},env) {
  const config=await storageConfig(env);
  await mkdir(privateRoot,{recursive:true});
  const bucketResponse=await request(config,'/bucket');
  if(!bucketResponse.ok)throw new Error('Bucket permission failed HTTP '+bucketResponse.status);
  const buckets=await bucketResponse.json();
  if(!Array.isArray(buckets))throw new Error('Unexpected Storage bucket list');
  const bucket=buckets.find(b=>b.id===manifest.bucket);
  if(!bucket) {
    const create=await request(config,'/bucket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:manifest.bucket,name:manifest.bucket,public:true,file_size_limit:15000000,allowed_mime_types:['image/png','video/mp4']})});
    if(!create.ok)throw new Error('Bucket creation failed HTTP '+create.status);
    await appendFile(storageJournal,JSON.stringify({owner,manifestSha256,action:'create-bucket',bucket:manifest.bucket,timestamp:new Date().toISOString()})+'\n',{mode:0o600});
  } else {
    if(!bucket.public)throw new Error('Existing bucket is private; no automatic ACL change');
  }
  const existingPaths=new Set();
  for(const role of [...new Set(manifest.assets.map(a=>a.role))]) {
    const prefix=owner+'/'+role;
    const response=await request(config,'/object/list/'+manifest.bucket,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prefix,limit:100,offset:0,sortBy:{column:'name',order:'asc'}})});
    if(!response.ok)throw new Error('Object inventory failed HTTP '+response.status);
    const objects=await response.json();
    if(!Array.isArray(objects)||objects.some(o=>typeof o.name!=='string'))throw new Error('Unexpected Storage object list');
    for(const o of objects)existingPaths.add(prefix+'/'+o.name);
  }
  const results=[];
  for(const a of manifest.assets) {
    const url=config.url+'/storage/v1/object/public/'+manifest.bucket+'/'+a.storagePath;
    if(!existingPaths.has(a.storagePath)) {
      await appendFile(storageJournal,JSON.stringify({owner,manifestSha256,action:'upload-intent',path:a.storagePath,sha256:a.sha256,timestamp:new Date().toISOString()})+'\n',{mode:0o600});
      const response=await request(config,'/object/'+manifest.bucket+'/'+a.storagePath,{method:'POST',headers:{'Content-Type':a.mimeType,'Cache-Control':'max-age=31536000','x-upsert':'false'},body:await readFile(safeAssetPath(a.file))});
      if(!response.ok)throw new Error('Upload failed HTTP '+response.status+' (existing bytes never overwritten)');
      await appendFile(storageJournal,JSON.stringify({owner,manifestSha256,action:'uploaded',path:a.storagePath,sha256:a.sha256,timestamp:new Date().toISOString()})+'\n',{mode:0o600});
    }
    results.push(await verifyAsset(url,a));
  }
  await jsonWrite(resolve(evidenceRoot,'storage-readback.json'),{owner,manifestSha256,totalBytes:manifest.totalBytes,assets:results,timestamp:new Date().toISOString()});
  return {uploadedOrVerified:results.length,totalBytes:manifest.totalBytes};
}
async function preflight({manifest,manifestSha256},env) {
  const result={owner,manifestSha256,targetFingerprint:fingerprintExpected,timestamp:new Date().toISOString(),readOnly:true,writes:0,
    assetCount:manifest.assets.length,assetBytes:manifest.totalBytes,storageUrlPresent:!!env.SUPABASE_URL,
    serverCredentialPresent:!!(env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY),storageReady:false,writeWindowReady:false};
  try {await requireWindow(manifestSha256);result.writeWindowReady=true;}
  catch {result.writeWindowReason='missing_expired_or_mismatched';}
  if(!result.storageUrlPresent||!result.serverCredentialPresent)result.storageReason='private_configuration_missing';
  else {
    const config=await storageConfig(env),response=await request(config,'/bucket');
    if(!response.ok)throw new Error('Read-only Storage permission check failed HTTP '+response.status);
    const buckets=await response.json();
    if(!Array.isArray(buckets))throw new Error('Unexpected Storage bucket list');
    const bucket=buckets.find(b=>b.id===manifest.bucket);
    if(bucket&&!bucket.public)throw new Error('Existing public-media bucket is private; no ACL change');
    result.storageReady=true;result.bucketExists=!!bucket;result.bucketPublic=bucket?.public??null;
    result.uploadRequiresWriteWindow=false;
  }
  await jsonWrite(resolve(evidenceRoot,'a19-storage-preflight.json'),result);
  return result;
}
export async function classify(c,dataset,manifest,url,journal,lock=false) {
  const plan=[];
  const byTable=new Map();
  for(const r of [...dataset.rows,...dataset.adopted]) {
    if(!byTable.has(r.table))byTable.set(r.table,[]);
    byTable.get(r.table).push(r.key.id);
  }
  const foundByKey=new Map();
  for(const [table,column] of [['user_identities','username_normalized'],['properties','code']]) {
    const wanted=dataset.rows.filter(r=>r.table===table);
    if(!wanted.length)continue;
    const existing=await c.query(`SELECT id,${column} FROM xland.${table} WHERE ${column}=ANY($1::text[])`,[wanted.map(r=>r.values[column])]);
    if(existing.rows.some(row=>wanted.some(r=>r.values[column]===row[column]&&r.key.id!==row.id)))throw new Error('Unique key collision outside manifest');
  }
  for(const [table,ids] of [...byTable.entries()].sort(([a],[b])=>a.localeCompare(b))) {
    const found=await c.query(`SELECT * FROM xland.${identifier(table)} WHERE id=ANY($1::uuid[]) ORDER BY id${lock?' FOR UPDATE':''}`,[ids]);
    for(const row of found.rows)foundByKey.set(table+':'+row.id,row);
  }
  for(const r of dataset.rows) {
    const values=materialize(r.values,manifest,url);
    const found=foundByKey.get(r.table+':'+r.key.id);
    if(!found){plan.push({kind:'insert',table:r.table,key:r.key,values});continue;}
    const owned=journal?.entries.find(e=>e.kind==='insert'&&e.table===r.table&&same(e.key,r.key));
    if(!owned)throw new Error('Pre-existing deterministic ID is not journal-owned');
    const compare={...values};delete compare.password_hash;
    if(!same(subset(found,compare),compare))throw new Error('Own row changed outside seed; manual review required');
    plan.push({kind:'unchanged',table:r.table,key:r.key});
  }
  for(const r of dataset.adopted) {
    const found=foundByKey.get(r.table+':'+r.key.id);
    if(!found)throw new Error('Adopted fixture row disappeared');
    const values=materialize(r.values,manifest,url);
    const previous=journal?.entries.find(e=>e.kind==='update'&&e.table===r.table&&same(e.key,r.key));
    if(previous&&same(subset(found,values),values)){plan.push({kind:'unchanged',table:r.table,key:r.key});continue;}
    if(!same(subset(found,r.expected),r.expected))throw new Error('Adopted row preimage changed; no overwrite');
    plan.push({kind:'update',table:r.table,key:r.key,before:subset(found,values),values});
  }
  return plan;
}
const summarize=plan=>plan.reduce((out,r)=>{out[r.kind]=(out[r.kind]||0)+1;out.byTable[r.table]??={};out.byTable[r.table][r.kind]=(out.byTable[r.table][r.kind]||0)+1;return out;},{byTable:{}});
export async function applyEntries(c,entries) {
  for(const e of entries) {
    const ks=Object.keys(e.values);identifier(e.table);ks.forEach(identifier);
    if(e.kind==='insert')await c.query(`INSERT INTO xland.${e.table}(${ks.join(',')}) VALUES(${ks.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(e.values).map(sqlValue));
    else {
      const result=await c.query(`UPDATE xland.${e.table} SET ${ks.map((k,i)=>k+'=$'+(i+2)).join(',')} WHERE id=$1`,[e.key.id,...Object.values(e.values).map(sqlValue)]);
      if(result.rowCount!==1)throw new Error('Scoped update affected unexpected rows');
    }
  }
}
export async function undoEntries(c,entries) {
  for(const e of [...entries].reverse()) {
    const found=(await c.query(`SELECT * FROM xland.${identifier(e.table)} WHERE id=$1 FOR UPDATE`,[e.key.id])).rows[0];
    if(!found||!same(subset(found,e.values),e.values))throw new Error('Rollback conflict; row changed after seed');
    if(e.kind==='insert')await c.query(`DELETE FROM xland.${identifier(e.table)} WHERE id=$1`,[e.key.id]);
    else await c.query(`UPDATE xland.${identifier(e.table)} SET ${Object.keys(e.before).map((k,i)=>identifier(k)+'=$'+(i+2)).join(',')} WHERE id=$1`,[e.key.id,...Object.values(e.before).map(sqlValue)]);
  }
}
async function seed(bundle,env,apply=false) {
  const {manifest,dataset,manifestSha256}=bundle;
  const url=env.SUPABASE_URL?new URL(env.SUPABASE_URL).origin:'https://storage-config-required.invalid';
  const journal=await readJournal();
  if(journal&&(journal.owner!==owner||journal.manifestSha256!==manifestSha256||journal.targetFingerprint!==fingerprintExpected||journal.status==='rolled-back'))throw new Error('Journal owner/manifest mismatch');
  if(journal&&journal.status!=='committed')throw new Error('Pending journal requires recovery audit before retry');
  if(apply) {
    await requireWindow(manifestSha256);
    await storageConfig(env);
    const readback=JSON.parse(await readFile(resolve(evidenceRoot,'storage-readback.json'),'utf8'));
    if(readback.manifestSha256!==manifestSha256||readback.assets.length!==manifest.assets.length)throw new Error('Storage readback missing or stale');
    for(const a of manifest.assets)await verifyAsset(`${url}/storage/v1/object/public/${manifest.bucket}/${a.storagePath}`,a);
  }
  const pool=poolFor(env);
  try {
    const c=await pool.connect();
    try {
      await c.query(apply?'BEGIN':'BEGIN READ ONLY');
      if(apply)await c.query('SELECT pg_advisory_xact_lock(783134222)');
      const plan=await classify(c,dataset,manifest,url,journal,apply);
      const summary=summarize(plan);
      if(apply) {
        // Storage verification/row locks can outlive a short coordination window.
        await requireWindow(manifestSha256);
        const entries=plan.filter(r=>r.kind!=='unchanged');
        if(entries.length) {
          if(journal)throw new Error('Partial manifest state needs audit; refusing incremental mutation');
          for(const e of entries.filter(e=>e.table==='user_identities'))e.values.password_hash=await argon2.hash(randomBytes(48).toString('base64url'),{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
          const next={owner,manifestSha256,targetFingerprint:fingerprintExpected,status:'prepared',timestamp:new Date().toISOString(),entries};
          await mkdir(privateRoot,{recursive:true});
          const f=await open(journalFile,'wx',0o600);try{await f.writeFile(JSON.stringify(next,null,2));await f.sync();}finally{await f.close();}
          await applyEntries(c,entries);
          await c.query('COMMIT');
          next.status='committed';await jsonWrite(journalFile,next);
        }else await c.query('COMMIT');
      } else await c.query('COMMIT');
      const result={owner,manifestSha256,fingerprint:fingerprintExpected,mode:apply?'apply':'dry-run',readOnly:!apply,storageConfigured:!!env.SUPABASE_URL,
        ...summary,writes:apply?(summary.insert||0)+(summary.update||0):0,timestamp:new Date().toISOString()};
      await jsonWrite(resolve(evidenceRoot,apply?'seed-result.json':'dry-run.json'),result);
      return result;
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
  }finally{await pool.end();}
}
async function rollback(bundle,env) {
  await requireWindow(bundle.manifestSha256);
  const journal=await readJournal();
  if(!journal||journal.owner!==owner||journal.status!=='committed'||journal.manifestSha256!==bundle.manifestSha256)throw new Error('No committed own-run journal');
  const pool=poolFor(env);
  try {
    const c=await pool.connect();
    try {
      await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(783134222)');
      await undoEntries(c,journal.entries);
      await c.query('COMMIT');journal.status='rolled-back';await jsonWrite(journalFile,journal);
      return {owner,rolledBack:journal.entries.length,storageDeleted:0,note:'Storage objects retained; bucket never deleted. See private upload journal.'};
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }finally{await pool.end();}
}
async function rollbackStorage(bundle,env) {
  const config=await storageConfig(env),journal=await readJournal();
  if(journal&&journal.status!=='rolled-back')throw new Error('Rollback DB before removing referenced media');
  const log=(await readFile(storageJournal,'utf8')).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
  const owned=log.filter(e=>e.owner===owner&&e.manifestSha256===bundle.manifestSha256&&e.action==='uploaded');
  const selected=bundle.manifest.assets.filter(a=>owned.some(e=>e.path===a.storagePath&&e.sha256===a.sha256)&&
    !log.some(e=>e.owner===owner&&e.manifestSha256===bundle.manifestSha256&&e.action==='deleted'&&e.path===a.storagePath));
  const pool=poolFor(env);
  try {
    const c=await pool.connect();
    try {
      await c.query('BEGIN READ ONLY');
      const prefix=config.url+'/storage/v1/object/public/'+bundle.manifest.bucket+'/'+owner+'/%';
      const uses=(await c.query(`SELECT
        (SELECT count(*) FROM xland.property_media WHERE public_url LIKE $1 OR thumbnail_url LIKE $1)+
        (SELECT count(*) FROM xland.user_profiles WHERE avatar_url LIKE $1)+
        (SELECT count(*) FROM xland.consultants WHERE avatar_url LIKE $1 OR cover_url LIKE $1)+
        (SELECT count(*) FROM xland.events WHERE media::text LIKE '%'||replace($1,'%','')||'%')+
        (SELECT count(*) FROM xland.clubs WHERE media::text LIKE '%'||replace($1,'%','')||'%') AS uses`,[prefix])).rows[0].uses;
      await c.query('COMMIT');
      if(Number(uses)!==0)throw new Error('Storage assets still referenced; no deletes');
    }finally{c.release();}
  }finally{await pool.end();}
  for(const a of selected) {
    const url=config.url+'/storage/v1/object/public/'+bundle.manifest.bucket+'/'+a.storagePath;
    await verifyAsset(url,a);
    const response=await request(config,'/object/'+bundle.manifest.bucket,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[a.storagePath]})});
    if(!response.ok)throw new Error('Own object deletion failed HTTP '+response.status);
    await appendFile(storageJournal,JSON.stringify({owner,manifestSha256:bundle.manifestSha256,action:'deleted',path:a.storagePath,timestamp:new Date().toISOString()})+'\n',{mode:0o600});
  }
  return {owner,deletedOwnObjects:selected.length,bucketDeleted:false};
}
async function readback(bundle,env) {
  const journal=await readJournal();
  if(journal?.status!=='committed')throw new Error('Readback requires committed own-run journal');
  const {manifest,dataset}=bundle,config=await storageConfig(env);
  const assets=[];for(const a of manifest.assets)assets.push(await verifyAsset(`${config.url}/storage/v1/object/public/${manifest.bucket}/${a.storagePath}`,a));
  const base=env.P3_READBACK_API_URL||'http://127.0.0.1:3002/api/v1';
  const api=new URL(base);
  if(api.protocol!=='https:'&&!(api.protocol==='http:'&&['127.0.0.1','localhost'].includes(api.hostname)))throw new Error('Readback API must be HTTPS or loopback');
  const get=async path=>{const r=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('API readback HTTP '+r.status);return r.json();};
  const properties=[];
  for(const row of dataset.rows.filter(r=>r.table==='properties')) {
    const {data:p}=await get('/properties/'+row.key.id);
    if(p.id!==row.key.id||!p.isIllustrative||!same(p.priceTotal,row.values.price_total)||!same(p.areaM2,row.values.area_m2)||!p.media.some(m=>m.url?.startsWith(config.url)))throw new Error('API property relation/price/media mismatch');
    properties.push({id:p.id,media:p.media.length,consultantId:p.consultantId});
  }
  const videos=[];
  for(const row of dataset.rows.filter(r=>r.table==='videos')) {
    const {data:v}=await get('/videos/'+row.key.id),{data:comments}=await get('/videos/'+row.key.id+'/comments?limit=50');
    const count=dataset.rows.filter(r=>r.table==='video_comments'&&r.values.video_id===row.key.id).length;
    const media=dataset.rows.find(r=>r.table==='property_media'&&r.key.id===row.values.media_id);
    if(v.propertyId!==row.values.property_id||v.author.id!==row.values.author_id||v.media.url!==materialize(media.values.public_url,manifest,config.url)||v.commentCount!==count||comments.length!==count||comments.some(c=>c.canDelete))throw new Error('API video/comments mismatch');
    videos.push({id:v.id,propertyId:v.propertyId,authorId:v.author.id,commentCount:v.commentCount,likeCount:v.likeCount});
  }
  const consultants=[];
  for(const row of dataset.rows.filter(r=>r.table==='consultants')) {
    const {data:c}=await get('/consultants/'+row.key.id);
    if(c.isVerified||c.videoCount!==row.values.video_count||c.followerCount!==0)throw new Error('API consultant counters/verification mismatch');
    consultants.push({id:c.id,videoCount:c.videoCount,followerCount:c.followerCount});
  }
  const result={owner,manifestSha256:bundle.manifestSha256,timestamp:new Date().toISOString(),assets,properties,videos,consultants,
    normalApi:true,demoMediaOverlay:false};
  await jsonWrite(resolve(evidenceRoot,'api-readback.json'),result);
  return {assets:assets.length,properties:properties.length,videos:videos.length,consultants:consultants.length};
}
export async function main(command=process.argv[2]||'dry-run') {
  const bundle=await loadBundle(),{env}=await targetEnvironment();
  await mkdir(evidenceRoot,{recursive:true});
  if(command==='dry-run')return seed(bundle,env);
  if(command==='preflight')return preflight(bundle,env);
  if(command==='upload')return upload(bundle,env);
  if(command==='apply')return seed(bundle,env,true);
  if(command==='rollback')return rollback(bundle,env);
  if(command==='rollback-storage')return rollbackStorage(bundle,env);
  if(command==='readback')return readback(bundle,env);
  throw new Error('Use preflight | dry-run | upload | apply | readback | rollback | rollback-storage');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(r=>console.log(JSON.stringify(r))).catch(e=>{
  // Never print SQL detail, DSN, provider response or credentials.
  console.error(JSON.stringify({errorCode:e.code||'ENRICHMENT_STOPPED',message:e.code?'Operation failed; transaction rolled back. Inspect privately.':e.message}));process.exitCode=1;
});
