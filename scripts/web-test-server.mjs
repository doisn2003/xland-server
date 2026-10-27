// Isolated website acceptance server. Never reads .env or shared DATABASE_URL.
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { localPostgres } from './local-postgres.mjs';
import { migrate } from '../src/repositories/migrations.ts';
import { seed, randomTestAccount } from '../src/repositories/seed.ts';
import { Database } from '../src/repositories/database.ts';
import { AuthService } from '../src/services/auth.ts';
import { ExtendedAuthService } from '../src/auth/extended-auth.ts';
import { CoreService } from '../src/services/core.ts';
import { CursorCodec } from '../src/services/cursor.ts';
import { createApp } from '../src/app.ts';
import { apiRouter } from '../src/routes/v1/api.ts';
import { seedSubplotsQa } from './seed-subplots-qa.mjs';

const local = await localPostgres({ directory: resolve('.local/web-user'), port: 55448 });
const root = new pg.Client({ connectionString: local.rootUrl });
await root.connect();
const name = 'xland_test_web_' + randomBytes(6).toString('hex');
await root.query(`CREATE DATABASE ${name}`);
const url = new URL(local.rootUrl); url.pathname = '/' + name;
const db = new Database(url.toString());
let server;
try {
  await migrate(db.pool);
  const accounts = Array.from({ length: 18 }, () => randomTestAccount());
  await seed(db.pool, accounts);
  const subdivision=await seedSubplotsQa(db,accounts[0].id);
  await db.pool.query('UPDATE xland.site_visit_slots SET max_bookings=100');
  const properties = (await db.pool.query("SELECT id,price_total FROM xland.properties WHERE status='listed' AND approval_status='approved' ORDER BY id")).rows;
  const slot = (await db.pool.query("SELECT id,property_id FROM xland.site_visit_slots WHERE status='open' ORDER BY starts_at LIMIT 1")).rows[0];
  const video = (await db.pool.query('SELECT id,author_id,property_id FROM xland.videos ORDER BY id LIMIT 1')).rows[0];
  const event = (await db.pool.query("SELECT id FROM xland.events WHERE status='open' AND starts_at>now() ORDER BY starts_at LIMIT 1")).rows[0];
  if (!slot || !video || !event || !properties.length) throw new Error('Acceptance fixture missing required records');
  const ordinaryAuthor = accounts.at(-1).id;
  await db.pool.query('UPDATE xland.videos SET author_id=$1 WHERE id=$2', [ordinaryAuthor, video.id]);
  const startedEvent = randomUUID(), cancelledEvent = randomUUID();
  for (const [id, status] of [[startedEvent, 'open'], [cancelledEvent, 'cancelled']]) {
    await db.pool.query(`INSERT INTO xland.events(id,title,starts_at,ends_at,venue_name,address,max_slots,duration_mins,ticket_price,status,agenda,speakers,benefits)
      VALUES($1,'Sự kiện kiểm tra trạng thái',now()-interval '1 minute',now()+interval '59 minutes','Địa điểm kiểm thử','Khu vực kiểm thử',10,60,'0',$2,'[]','[]','[]')`, [id, status]);
  }
  const schema = (await db.pool.query("SELECT count(*)::int tables,bool_and(relrowsecurity) rls,bool_and(relforcerowsecurity) force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='xland' AND c.relkind='r'")).rows[0];
  const auth = new AuthService(db, () => new Date(), 1000); await auth.initialize();
  const core = new CoreService(db, auth, new CursorCodec(randomBytes(32)), () => new Date(), 'https://xland.example.test');
  const maps = { presentation: async propertyId => ({ propertyId, availability: 'unconfigured', provider: 'none', poiMode: 'none', publicArea: null, areaLabel: null, attribution: [], notice: 'Bản đồ khu vực tham khảo; không thể hiện vị trí lô đất.', externalAreaMapUrl: null, externalDirectionsUrl: null, embedPageUrl: null, tilePathTemplate: null }) };
  const app = createApp({ checkReadiness: () => db.ready(), api: apiRouter(core, [], new ExtendedAuthService(db, auth), maps) });
  await mkdir('.local', { recursive: true });
  await writeFile('.local/web-user-acceptance.json', JSON.stringify({ accounts, properties, slot, video, event, ordinaryAuthor, startedEvent, cancelledEvent, schema, subdivision }), { mode: 0o600 });
  server = app.listen(3311, '127.0.0.1', () => console.log('Website acceptance API ready on loopback:3311; isolated PostgreSQL only.'));
} catch (error) {
  await db.pool.end(); await root.end(); await local.stop(); throw error;
}
let stopping = false;
async function stop() { if (stopping) return; stopping = true; server.closeAllConnections(); await new Promise(done => server.close(done)); await db.pool.end(); await root.end(); await local.stop(); process.exit(0); }
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
