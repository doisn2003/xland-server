import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {parse} from 'dotenv';
import {Database} from '../src/repositories/database.js';
import {databaseTarget} from '../src/config/database-target.js';
const context=JSON.parse(await readFile('.local/p3-context.json','utf8'));
const reportMode=process.argv.includes('--report');
const journal=JSON.parse(await readFile(reportMode?'.local/p3-report-journal.json':'.local/p3-w1-journal.json','utf8'));
const target=databaseTarget(parse(await readFile('.env.supabase-mock','utf8')),false);assert.equal(target.fingerprint,'03d6c297d77a1029');
const db=new Database(target.connectionString,2);
try{
 const owners=[];
 for(const [index,account] of journal.accounts.entries()){
  const proof=await db.transaction('xland_api',account.id,async c=>{
   const identity=await c.query('SELECT current_user AS role,current_setting(\'xland.user_id\') IS NOT NULL AS identity_set');
   const bookings=await c.query('SELECT id,property_id,slot_id,status,attendee_count,customer_name,note FROM xland.site_visit_bookings ORDER BY created_at');
   const payments=await c.query('SELECT booking_id,status,mode FROM xland.payment_intents ORDER BY created_at');
   const profile=await c.query('SELECT phone IS NULL AS phone_is_null,phone_verified_at IS NOT NULL AS contact_verified FROM xland.user_contacts WHERE user_id=$1',[account.id]);
   const settings=await c.query('SELECT feed_autoplay,feed_muted_by_default FROM xland.user_settings WHERE user_id=$1',[account.id]);
   const counts=await c.query(`SELECT
    (SELECT count(*)::int FROM xland.saved_properties WHERE user_id=$1) saved_properties,
    (SELECT count(*)::int FROM xland.saved_videos WHERE user_id=$1) saved_videos,
    (SELECT count(*)::int FROM xland.video_comments WHERE author_id=$1 AND deleted_at IS NULL) comments,
    (SELECT count(*)::int FROM xland.saved_finance_plans WHERE user_id=$1) finance_plans,
    (SELECT count(*)::int FROM xland.event_registrations WHERE user_id=$1) event_registrations,
    (SELECT count(*)::int FROM xland.support_requests WHERE user_id=$1) support_requests`,[account.id]);
   const idempotency=await c.query('SELECT operation,resource_id,response_status FROM xland.idempotency_records WHERE user_id=$1 ORDER BY operation',[account.id]);
   return {identity:identity.rows[0],bookings:bookings.rows.map(r=>({id:r.id,propertyId:r.property_id,slotId:r.slot_id,status:r.status,attendeeCount:r.attendee_count,ownRun:r.note===journal.runLabel,uiCanary:r.customer_name==='DEMO C W1 UI'})),payments:payments.rows,profile:profile.rows,settings:settings.rows,counts:counts.rows[0],idempotency:idempotency.rows};
  },true);
  assert.equal(proof.identity.role,'xland_api');owners.push({owner:index===0?'A':'B',...proof});
 }
 const a=owners[0]!,b=owners[1]!;assert(a.bookings.length>=1);assert.equal(b.bookings.length,0);assert(a.bookings.every(r=>r.slotId===journal.slotId&&r.status==='awaiting_deposit'));assert(a.payments.every(r=>r.status==='unpaid'&&r.mode==='disabled'));assert.equal(b.payments.length,0);
 await writeFile(resolve(context.evidence,(reportMode?'report-':'')+'db-owner-proof-'+Date.now()+'.json'),JSON.stringify({timestamp:new Date().toISOString(),runLabel:journal.runLabel,sourceHash:context.sourceHash,bundleHash:context.bundleHash,environment:'supabase_mock',fingerprint:target.fingerprint,access:'SET LOCAL ROLE xland_api, per-owner identity, REPEATABLE READ READ ONLY; no privileged runtime/cache',owners,contactsMasked:true,remoteWrites:false},null,2));
 console.log(JSON.stringify({event:'w1_db_owner_proof_pass',aBookings:a.bookings.length,bBookings:b.bookings.length,allPendingUnpaid:true}));
}catch{console.error('W1 DB proof failed; details redacted, preserve evidence/journal');process.exitCode=1;}finally{await db.close();}
