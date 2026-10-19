// Read-only ownership/refcount audit. Deliberately has no mutation/apply mode.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {serverRoot,evidenceRoot,sha256,targetEnvironment,poolFor} from './inventory.mjs';
const readJson=async p=>JSON.parse(await readFile(resolve(serverRoot,p),'utf8'));
const identifier=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw new Error('Unsafe identifier');return s;};
const snapshotPath=resolve(evidenceRoot,'content-before.json'),manifestPath=resolve(serverRoot,'fixtures/p3-enrichment/manifest.json');
const protectedBefore={snapshotSha256:sha256(await readFile(snapshotPath)),manifestFileSha256:sha256(await readFile(manifestPath)),
  manifestSha256:sha256(JSON.stringify(JSON.parse(await readFile(manifestPath,'utf8'))))};
const snapshot=await readJson('../brain/logs/agent-database/evidence/content-before.json');
const fixturePath='../brain/logs/agent-c/fixtures/v0.1.json';
const sourcePath='scripts/verify-feed-performance.ts';
const historyPath='../brain/logs/agent-c/evidence/P2-CLOSEOUT-02/20261017T164110287Z/feed-performance-supabase.json';
const fixture=await readJson(fixturePath),history=await readJson(historyPath);
const context=await readJson('.local/feed-benchmark-context.json');
// Read only the known creator's public identity; never export account credentials.
const privateAccounts=await readJson('.local/closeout-accounts.json');
const creatorId=privateAccounts.accounts[0].id;
if(context.runLabel!=='c-closeout02-feed-f9548824'||history.runLabel!==context.runLabel||context.rows.length!==60||history.addedMockVideoIds.length!==60)throw new Error('Historical ownership context mismatch');
const historicalIds=new Set(history.addedMockVideoIds);
if(context.rows.some(r=>!historicalIds.has(r.id)))throw new Error('Historical/public ID list differs from private journal');
const {env,fingerprint}=await targetEnvironment(),pool=poolFor(env);
try {
  const c=await pool.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const ledger=(await c.query('SELECT id,digest FROM xland_meta.migrations ORDER BY id')).rows;
    const oldIds=snapshot.videos.map(v=>v.id);
    const videos=(await c.query('SELECT * FROM xland.videos WHERE id=ANY($1::uuid[]) ORDER BY id',[oldIds])).rows;
    const mediaIds=[...new Set(videos.map(v=>v.media_id))];
    const media=(await c.query('SELECT * FROM xland.property_media WHERE id=ANY($1::uuid[]) ORDER BY id',[mediaIds])).rows;
    const fks=(await c.query(`SELECT ns.nspname table_schema,t.relname table_name,ft.relname referenced_table,
      array_agg(a.attname::text ORDER BY keys.n) columns,array_agg(fa.attname::text ORDER BY keys.n) referenced_columns
      FROM pg_constraint co JOIN pg_class t ON t.oid=co.conrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace
      JOIN pg_class ft ON ft.oid=co.confrelid JOIN pg_namespace fns ON fns.oid=ft.relnamespace
      CROSS JOIN LATERAL generate_subscripts(co.conkey,1) keys(n)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=co.conkey[keys.n]
      JOIN pg_attribute fa ON fa.attrelid=ft.oid AND fa.attnum=co.confkey[keys.n]
      WHERE co.contype='f' AND ns.nspname='xland' AND fns.nspname='xland' AND ft.relname IN ('videos','property_media')
      GROUP BY co.oid,ns.nspname,t.relname,ft.relname ORDER BY t.relname,co.oid`)).rows;
    const referenceCounts={};
    for(const fk of fks) {
      const index=fk.referenced_columns.indexOf('id');if(index<0)continue;
      const column=identifier(fk.columns[index]),table=identifier(fk.table_name);
      const ids=fk.referenced_table==='videos'?oldIds:mediaIds;
      const counts=(await c.query(`SELECT ${column} id,count(*)::int n FROM xland.${table} WHERE ${column}=ANY($1::uuid[]) GROUP BY ${column}`,[ids])).rows;
      referenceCounts[fk.referenced_table+':'+table+'.'+column]=Object.fromEntries(counts.map(r=>[r.id,r.n]));
    }
    const total=(await c.query('SELECT count(*)::int videos FROM xland.videos')).rows[0].videos;
    await c.query('COMMIT');
    const byMedia=new Map(media.map(m=>[m.id,m]));
    const baselineIds=new Set(fixture.feedVideos.map(v=>v.id));
    const confirmed=[],baseline=[],unresolved=[];
    for(const v of videos) {
      const m=byMedia.get(v.media_id),index=context.rows.findIndex(r=>r.id===v.id),journalRow=context.rows[index];
      const refs=Object.fromEntries(Object.entries(referenceCounts).map(([label,counts])=>[label,counts[label.startsWith('videos:')?v.id:v.media_id]||0]));
      const preimage={video:v,media:m},entry={id:v.id,mediaId:v.media_id,propertyId:v.property_id,preimage,
        preimageSha256:sha256(JSON.stringify(preimage)),references:refs};
      if(index>=0&&v.caption==='XLAND DEMO ONLY '+context.runLabel+' '+index&&v.author_id===creatorId&&journalRow.mediaId===v.media_id&&
        v.is_illustrative===true&&m?.is_illustrative===true&&m.usage==='feed'&&m.sort_order===journalRow.sort&&m.alt_text==='XLAND DEMO ONLY '+context.runLabel) {
        confirmed.push({...entry,classification:'confirmed-benchmark-run',creatorRun:context.runLabel,
          proposal:{execute:false,delete:false,mediaDelete:false,optionAfterAReview:{table:'videos',key:{id:v.id},before:{approval_status:v.approval_status,deleted_at:v.deleted_at},after:{approval_status:'pending'}},reason:'Preserve row/relations/history; exclude only explicitly approved benchmark records from public feed in separate future cleanup run.'}});
      }else if(baselineIds.has(v.id)) baseline.push({...entry,classification:'locked-foundation-fixture',execute:false,reason:'Present in C3/C4 fixture of 24 videos; not owned by benchmark run. Keep pending separate exact scope decision.'});
      else unresolved.push({...entry,classification:'unresolved',execute:false});
    }
    const result={timestamp:new Date().toISOString(),fingerprint,readOnly:true,writes:0,mode:'preview-only',
      requestedAcceptanceCount:80,verifiedBenchmarkOwnership:confirmed.length,lockedFoundationCount:baseline.length,
      unknownCount:unresolved.length,totalCurrentVideos:total,reviewedOriginalIds:oldIds.length,missingOriginalIds:oldIds.filter(id=>!videos.some(v=>v.id===id)),
      finding:'84 original rows = 60 journal-owned benchmark videos + 24 locked foundation fixtures. A cleanup set of 80 is not proven. Do not select an arbitrary 20 foundation rows to reach 80.',
      protectedV1Preimages:protectedBefore,
      sources:await Promise.all([sourcePath,fixturePath,historyPath].map(async path=>({path,sha256:sha256(await readFile(resolve(serverRoot,path)))}))),
      migration0009Applied:ledger.some(r=>r.id==='0009_auth_extension.sql'),ledger,confirmed,baseline,unresolved,
      executionPolicy:'No DELETE/UPDATE exists in this script. Re-preview after v1 seed because media preimages change; do not edit enrichment v1 manifest/snapshot. Separate cleanup approval, journal and write window required.'};
    if(sha256(await readFile(snapshotPath))!==protectedBefore.snapshotSha256||sha256(await readFile(manifestPath))!==protectedBefore.manifestFileSha256)throw new Error('v1 inputs changed during audit');
    await writeFile(resolve(evidenceRoot,'a19-legacy-cleanup-preview.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({fingerprint,readOnly:true,writes:0,requestedAcceptanceCount:80,verifiedBenchmarkOwnership:confirmed.length,lockedFoundationCount:baseline.length,unknownCount:unresolved.length,missingOriginalIds:result.missingOriginalIds.length,totalCurrentVideos:total,migration0009Applied:result.migration0009Applied,protectedV1Preimages:protectedBefore}));
  }finally{c.release();}
}catch(e){console.error(JSON.stringify({errorCode:e.code||'CLEANUP_AUDIT_FAILED',message:e.code?'Read-only audit failed; no writes':e.message}));process.exitCode=1;}
finally{await pool.end();}
