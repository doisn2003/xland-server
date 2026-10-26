import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import pg from 'pg';
import type { Pool } from 'pg';
import { databaseTarget } from '../src/config/database-target.js';
import { communityClub, communityEvents } from './community-catalog.js';

/** Additive and replay-safe: never replaces an edited event or its registrations. */
export async function seedCommunity(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(2026102601)');
    const c = communityClub;
    const club = await client.query(`INSERT INTO xland.clubs
      (id,title,summary,description,region_label,activities,media,is_illustrative)
      VALUES($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT(id) DO NOTHING`,
    [c.id,c.title,c.summary,c.description,c.regionLabel,JSON.stringify(c.activities),JSON.stringify(c.media)]);
    let insertedEvents = 0;
    for (const e of communityEvents) {
      const inserted = await client.query(`INSERT INTO xland.events
        (id,title,tags,media,starts_at,ends_at,time_zone,venue_name,address,max_slots,duration_mins,ticket_price,status,agenda,speakers,benefits,is_illustrative)
        VALUES($1,$2,$3,$4,$5,$6,'Asia/Ho_Chi_Minh',$7,$8,$9,$10,$11,'open',$12,$13,$14,true)
        ON CONFLICT(id) DO NOTHING`, [e.id,e.title,JSON.stringify(e.tags),JSON.stringify(e.media),
        e.startsAt,e.endsAt,e.venueName,e.address,e.maxSlots,e.durationMinutes,e.ticketPriceVnd,
        JSON.stringify(e.agenda),JSON.stringify(e.speakers),JSON.stringify(e.benefits)]);
      insertedEvents += inserted.rowCount ?? 0;
    }
    const events = (await client.query(`SELECT id,title,tags,starts_at FROM xland.events
      WHERE id=ANY($1::uuid[]) ORDER BY starts_at`, [communityEvents.map(e => e.id)])).rows;
    if (events.length !== 6) throw new Error('COMMUNITY_SEED_COUNT_MISMATCH');
    await client.query('COMMIT');
    return {insertedClubs: club.rowCount ?? 0, insertedEvents, clubId: c.id, events};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let pool: Pool | undefined;
  try {
    // The known demo target metadata and separate admin credential stay private.
    const runtime = parse(await readFile('.env.supabase-mock', 'utf8'));
    const admin = parse(await readFile('.env', 'utf8'));
    const target = databaseTarget({...runtime, DATABASE_URL: admin.DATABASE_URL}, false);
    if (!process.argv.includes('--apply')) {
      console.log(JSON.stringify({mode:'preview', fingerprint:target.fingerprint,
        club:communityClub.title, events:communityEvents.map(e => ({title:e.title,tags:e.tags,startsAt:e.startsAt})),
        apply:'node --import tsx scripts/seed-community.ts --apply'}, null, 2));
    } else {
      pool = new pg.Pool({connectionString:target.connectionString,max:1,connectionTimeoutMillis:10000,query_timeout:30000});
      console.log(JSON.stringify({fingerprint:target.fingerprint,...await seedCommunity(pool)}, null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({event:'community_seed_failed',code:(error as {code?:string}).code ?? 'CHECK_FAILED'}));
    process.exitCode = 1;
  } finally { await pool?.end(); }
}
