// v1.1 repair: one JSONB field on the 16 journal-owned properties, no media upload.
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {serverRoot,evidenceRoot,sha256,targetEnvironment,poolFor,fingerprintExpected} from './inventory.mjs';
import {propertyHighlights} from './nested-json.mjs';
import {same,validateDataset,validateWriteWindow} from './pipeline.mjs';
const base=resolve(serverRoot,'fixtures/p3-enrichment');
const revisionRoot=resolve(base,'revisions/v1.1-highlights');
const privateRoot=resolve(serverRoot,'.local/p3-enrichment');
const journalPath=resolve(privateRoot,'highlights-repair-journal.json');
const repairOwner='xland-p3-enrichment-v1.1-highlights';
const baseHash='7a86a89504ae613d07b0ae727f5c735db9befbbf873896d4af027ae5c6de7c46';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const save=async(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n',{mode:0o600});
export async function repairBundle() {
  const manifest=await read(resolve(base,'manifest.json')),dataset=await read(resolve(base,'dataset.json'));
  if(sha256(JSON.stringify(manifest))!==baseHash||sha256(JSON.stringify(dataset))!==manifest.datasetSha256)throw new Error('Immutable v1 inputs changed');
  const revised=structuredClone(dataset),changes=[];
  for(const row of revised.rows.filter(r=>r.table==='properties')) {
    const before=structuredClone(row.values.highlights),after=propertyHighlights(row.values);
    changes.push({table:'properties',key:row.key,expected:{highlights:before},values:{highlights:after}});
    row.values.highlights=after;
  }
  if(changes.length!==16)throw new Error('Repair must contain exactly 16 owned properties');
  const revisedManifest={...manifest,revision:'v1.1-highlights',baseManifestSha256:baseHash,datasetSha256:sha256(JSON.stringify(revised)),
    repairOwner,repairScope:{table:'properties',columns:['highlights'],ids:changes.map(r=>r.key.id),updates:16,assetUploads:0}};
  validateDataset(revisedManifest,revised);
  const repair={owner:repairOwner,targetFingerprint:fingerprintExpected,baseManifestSha256:baseHash,
    revisedManifestSha256:sha256(JSON.stringify(revisedManifest)),revisedDatasetSha256:revisedManifest.datasetSha256,
    scope:{table:'properties',columns:['highlights'],ids:changes.map(r=>r.key.id),updates:16,assetUploads:0},changes};
  return {manifest:revisedManifest,dataset:revised,repair,repairSha256:sha256(JSON.stringify(repair))};
}
async function prepared() {
  const b=await repairBundle(),saved=await read(resolve(revisionRoot,'repair-manifest.json'));
  if(!same(saved,b.repair))throw new Error('Prepared repair differs from generated exact delta');
  return b;
}
async function requireRepairWindow(b) {
  const w=await read(resolve(serverRoot,'../brain/logs/agent-database/WRITE_WINDOW_HIGHLIGHTS_REPAIR.json'));
  // Reuse strict window validation with the base owner override solely for its generic checks.
  if(w.owner!==repairOwner||w.revisedManifestSha256!==b.repair.revisedManifestSha256||w.repairSha256!==b.repairSha256||w.scope!=='properties.highlights:16-own-ids')throw new Error('Repair window owner/hash/scope mismatch');
  validateWriteWindow({...w,owner:'xland-p3-enrichment-v1'},b.repair.revisedManifestSha256);
}
export async function planRepair(c,b,journal=null,lock=false) {
  const ids=b.repair.scope.ids;
  const rows=(await c.query(`SELECT id,highlights FROM xland.properties WHERE id=ANY($1::uuid[]) ORDER BY id${lock?' FOR UPDATE':''}`,[ids])).rows;
  if(rows.length!==16)throw new Error('A repair-owned property disappeared');
  const plan=[];
  for(const delta of b.repair.changes) {
    const row=rows.find(r=>r.id===delta.key.id);
    if(same(row.highlights,delta.expected.highlights))plan.push({kind:'update',id:row.id,before:row.highlights,after:delta.values.highlights});
    else if(journal?.status==='committed'&&journal.repairSha256===b.repairSha256&&same(row.highlights,delta.values.highlights))plan.push({kind:'unchanged',id:row.id});
    else throw new Error('Exact highlights precondition failed or after-value lacks own repair journal');
  }
  return plan;
}
async function loadRepairJournal() {try{return await read(journalPath);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function auditBaseOwnership(b) {
  const journal=await read(resolve(privateRoot,'journal.json'));
  if(journal.status!=='committed'||journal.manifestSha256!==baseHash)throw new Error('Committed v1 ownership journal required');
  for(const delta of b.repair.changes) {
    const entry=journal.entries.find(e=>e.kind==='insert'&&e.table==='properties'&&e.key.id===delta.key.id);
    if(!entry||!same(entry.values.highlights,delta.expected.highlights))throw new Error('Repair ID/preimage not owned by base journal');
  }
}
export async function main(command=process.argv[2]||'dry-run') {
  if(command==='prepare') {
    const b=await repairBundle();await mkdir(revisionRoot,{recursive:true});
    await save(resolve(revisionRoot,'manifest.json'),b.manifest);await save(resolve(revisionRoot,'dataset.json'),b.dataset);
    await save(resolve(revisionRoot,'repair-manifest.json'),b.repair);
    return {owner:repairOwner,baseManifestSha256:baseHash,revisedManifestSha256:b.repair.revisedManifestSha256,
      revisedDatasetSha256:b.repair.revisedDatasetSha256,repairSha256:b.repairSha256,updates:16,assetUploads:0};
  }
  const b=await prepared();await auditBaseOwnership(b);
  const journal=await loadRepairJournal();
  if(journal&&(journal.owner!==repairOwner||journal.repairSha256!==b.repairSha256||journal.status!=='committed'))throw new Error('Repair journal mismatch/pending; audit before retry');
  const apply=command==='apply',rollback=command==='rollback';
  if(!['apply','dry-run','rollback'].includes(command))throw new Error('Use prepare | dry-run | apply | rollback');
  if(apply||rollback)await requireRepairWindow(b);
  const {env,fingerprint}=await targetEnvironment(),pool=poolFor(env);
  try {
    const c=await pool.connect();
    try {
      await c.query(apply||rollback?'BEGIN':'BEGIN READ ONLY');
      if(apply||rollback)await c.query('SELECT pg_advisory_xact_lock(783134222)');
      if(rollback) {
        if(!journal)throw new Error('No committed own repair journal');
        for(const e of [...journal.entries].reverse()) {
          const changed=await c.query('UPDATE xland.properties SET highlights=$2::jsonb WHERE id=$1 AND highlights=$3::jsonb',[e.id,JSON.stringify(e.before),JSON.stringify(e.after)]);
          if(changed.rowCount!==1)throw new Error('Repair rollback conflict; no partial restore');
        }
        await c.query('COMMIT');journal.status='rolled-back';await save(journalPath,journal);
        return {owner:repairOwner,rolledBack:journal.entries.length};
      }
      const plan=await planRepair(c,b,journal,apply),entries=plan.filter(r=>r.kind==='update');
      if(apply&&entries.length) {
        if(journal)throw new Error('Partial repaired state; no incremental overwrite');
        await requireRepairWindow(b);
        const next={owner:repairOwner,status:'prepared',baseManifestSha256:baseHash,revisedManifestSha256:b.repair.revisedManifestSha256,
          repairSha256:b.repairSha256,timestamp:new Date().toISOString(),entries};
        const f=await open(journalPath,'wx',0o600);try{await f.writeFile(JSON.stringify(next,null,2));await f.sync();}finally{await f.close();}
        for(const e of entries) {
          const changed=await c.query('UPDATE xland.properties SET highlights=$2::jsonb WHERE id=$1 AND highlights=$3::jsonb',[e.id,JSON.stringify(e.after),JSON.stringify(e.before)]);
          if(changed.rowCount!==1)throw new Error('Exact highlights CAS failed');
        }
        await c.query('COMMIT');next.status='committed';await save(journalPath,next);
      }else await c.query('COMMIT');
      const result={owner:repairOwner,fingerprint,mode:command,baseManifestSha256:baseHash,revisedManifestSha256:b.repair.revisedManifestSha256,
        repairSha256:b.repairSha256,updates:entries.length,unchanged:plan.length-entries.length,writes:apply?entries.length:0,
        assetUploads:0,timestamp:new Date().toISOString()};
      await save(resolve(evidenceRoot,`a19-highlights-${command}.json`),result);return result;
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
  }finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(r=>console.log(JSON.stringify(r))).catch(e=>{
  console.error(JSON.stringify({errorCode:e.code||'HIGHLIGHTS_REPAIR_STOPPED',message:e.code?'Scoped repair failed; transaction rolled back':e.message}));process.exitCode=1;
});
