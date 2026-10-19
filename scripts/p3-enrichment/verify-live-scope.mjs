// Post-seed READ ONLY audit; never rewrites the immutable v1 snapshot.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {serverRoot,evidenceRoot,sha256,targetEnvironment,poolFor} from './inventory.mjs';
import {classify,same,storageConfig,subset} from './pipeline.mjs';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const root=resolve(serverRoot,'fixtures/p3-enrichment');
const manifest=await read(resolve(root,'manifest.json')),dataset=await read(resolve(root,'dataset.json'));
const snapshotFile=resolve(evidenceRoot,'content-before.json'),snapshot=await read(snapshotFile);
const inventory=await read(resolve(evidenceRoot,'inventory.json'));
const journal=await read(resolve(serverRoot,'.local/p3-enrichment/journal.json'));
const manifestSha256=sha256(JSON.stringify(manifest));
if(journal.status!=='committed'||journal.manifestSha256!==manifestSha256||journal.owner!==manifest.owner)throw new Error('Committed own-run journal required');
const {env,fingerprint}=await targetEnvironment(),{url}=await storageConfig(env),pool=poolFor(env);
try {
  const c=await pool.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const classified=await classify(c,dataset,manifest,url,journal);
    if(classified.some(r=>r.kind!=='unchanged'))throw new Error('Manifest rows drifted after seed');
    const unchangedOriginalRows={},allowedAdoptions={};
    for(const table of ['properties','videos','property_media','events','clubs','consultants']) {
      const ids=snapshot[table].map(r=>r.id),rows=(await c.query(`SELECT * FROM xland.${table} WHERE id=ANY($1::uuid[])`,[ids])).rows;
      if(rows.length!==ids.length)throw new Error('An original public content row disappeared');
      let unchanged=0,adopted=0;
      for(const before of snapshot[table]) {
        const found=rows.find(r=>r.id===before.id),plan=dataset.adopted.find(r=>r.table===table&&r.key.id===before.id);
        const keep=Object.fromEntries(Object.entries(before).filter(([key])=>!plan||!(key in plan.values)));
        if(!same(subset(found,keep),keep))throw new Error('Original row changed outside adopted columns in '+table);
        if(plan)adopted++;else unchanged++;
      }
      unchangedOriginalRows[table]=unchanged;allowedAdoptions[table]=adopted;
    }
    const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='xland' ORDER BY tablename")).rows;
    const counts={};
    for(const {tablename} of tables) {
      if(!/^[a-z_][a-z0-9_]*$/.test(tablename))throw new Error('Unsafe table identifier');
      counts[tablename]=(await c.query(`SELECT count(*)::int n FROM xland.${tablename}`)).rows[0].n;
    }
    const ownedIds=dataset.rows.filter(r=>r.table==='user_profiles').map(r=>r.key.id);
    const syntheticSafety=(await c.query(`SELECT
      (SELECT count(*)::int FROM xland.user_identities WHERE id=ANY($1::uuid[]) AND status='disabled') disabledIdentities,
      (SELECT count(*)::int FROM xland.user_profiles WHERE id=ANY($1::uuid[]) AND is_verified=false AND is_illustrative=true) unverifiedIllustrativeProfiles,
      (SELECT count(*)::int FROM xland.user_contacts WHERE user_id=ANY($1::uuid[])) contacts,
      (SELECT count(*)::int FROM xland.auth_external_identities WHERE user_id=ANY($1::uuid[])) externalIdentities,
      (SELECT count(*)::int FROM xland.auth_sessions WHERE user_id=ANY($1::uuid[])) sessions,
      (SELECT count(*)::int FROM xland.user_roles WHERE user_id=ANY($1::uuid[])) grantedRoles`,[ownedIds])).rows[0];
    if(syntheticSafety.disabledidentities!==30||syntheticSafety.unverifiedillustrativeprofiles!==30||syntheticSafety.contacts||syntheticSafety.externalidentities||syntheticSafety.sessions||syntheticSafety.grantedroles)throw new Error('Synthetic identity safety mismatch');
    const protectedTables=['user_contacts','user_settings','user_roles','auth_sessions','site_visit_bookings','booking_status_history','slot_reservations','payment_intents','payment_receipts','payment_status_history','payment_provider_events','property_documents','property_legal_items','document_access_grants','event_registrations','support_requests','idempotency_records','video_likes','author_follows','saved_videos','saved_properties','saved_events','saved_finance_plans','consultant_reviews'];
    const protectedCounts=Object.fromEntries(protectedTables.map(table=>[table,{before:inventory.counts[table],after:counts[table],equal:inventory.counts[table]===counts[table]}]));
    if(Object.values(protectedCounts).some(r=>!r.equal))throw new Error('Protected table count differs; review concurrent activity');
    const buckets=(await c.query('SELECT id,public FROM storage.buckets ORDER BY id')).rows;
    const objects=(await c.query('SELECT count(*)::int n FROM storage.objects WHERE bucket_id=$1 AND name LIKE $2',[manifest.bucket,manifest.prefix+'/%'])).rows[0].n;
    const ledger=(await c.query('SELECT id,digest FROM xland_meta.migrations ORDER BY id')).rows;
    await c.query('COMMIT');
    const result={timestamp:new Date().toISOString(),fingerprint,readOnly:true,writes:0,owner:manifest.owner,manifestSha256,
      immutableSnapshotSha256:sha256(await readFile(snapshotFile)),manifestRowsUnchanged:classified.length,
      unchangedOriginalRows,allowedAdoptions,counts,syntheticSafety,protectedCounts,buckets,storageObjectsUnderOwnPrefix:objects,
      all84LegacyVideoRowsUnchanged:unchangedOriginalRows.videos===84,cleanupWrites:0,ledger};
    await writeFile(resolve(evidenceRoot,'a19-live-scope-verification.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({fingerprint,manifestRowsUnchanged:classified.length,counts:{properties:counts.properties,consultants:counts.consultants,videos:counts.videos,media:counts.property_media,comments:counts.video_comments,profiles:counts.user_profiles},legacyVideosUnchanged:result.all84LegacyVideoRowsUnchanged,protectedTablesUnchanged:protectedTables.length,storageObjectsUnderOwnPrefix:objects,syntheticSafety,writes:0}));
  }finally{c.release();}
}catch(e){console.error(JSON.stringify({errorCode:e.code||'SCOPE_AUDIT_FAILED',message:e.code?'Read-only scope audit failed':e.message}));process.exitCode=1;}
finally{await pool.end();}
