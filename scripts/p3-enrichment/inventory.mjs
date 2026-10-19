import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import pg from 'pg';

export const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const evidenceRoot = resolve(serverRoot, '../brain/logs/agent-database/evidence');
export const fingerprintExpected = '03d6c297d77a1029';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function targetEnvironment() {
  // Current project target only. Never substitute .env.local/test/snapshot.
  const env = parse(await readFile(resolve(serverRoot, '.env'), 'utf8'));
  let privateEnv = {};
  try { privateEnv = parse(await readFile(resolve(serverRoot, '.env.p3-enrichment'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if ('DATABASE_URL' in privateEnv) throw new Error('Storage env must not override DATABASE_URL');
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid DB protocol');
  const fingerprint = sha256(url.hostname + url.pathname).slice(0, 16);
  if (fingerprint !== fingerprintExpected) throw new Error('Target fingerprint mismatch; no writes');
  return {env: {...env, ...privateEnv}, fingerprint};
}
export function poolFor(env) {
  return new pg.Pool({connectionString: env.DATABASE_URL, max: 1,
    connectionTimeoutMillis: 15000, query_timeout: 30000});
}
export async function inventory() {
  const {env, fingerprint} = await targetEnvironment();
  const pool = poolFor(env);
  try {
    const c = await pool.connect();
    try {
      await c.query('BEGIN READ ONLY');
      const metadata = (await c.query("SELECT current_database() database,current_user role,current_setting('server_version') version,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) superuser,(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) bypassrls")).rows[0];
      const tables = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='xland' ORDER BY tablename")).rows;
      const counts = {};
      for (const {tablename} of tables) {
        if (!/^[a-z_]+$/.test(tablename)) throw new Error('Unsafe identifier');
        counts[tablename] = Number((await c.query(`SELECT count(*) FROM xland.${tablename}`)).rows[0].count);
      }
      const ledger = (await c.query('SELECT id,digest FROM xland_meta.migrations ORDER BY id')).rows;
      const columns = (await c.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='xland' ORDER BY table_name,ordinal_position")).rows;
      const roles = (await c.query("SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname LIKE 'xland_%' ORDER BY rolname")).rows;
      const buckets = await c.query("SELECT id,name,public,file_size_limit,allowed_mime_types FROM storage.buckets ORDER BY id");
      const media = (await c.query('SELECT kind,usage,count(*)::int total,count(public_url)::int with_url FROM xland.property_media GROUP BY kind,usage ORDER BY kind,usage')).rows;
      const locations = (await c.query('SELECT * FROM xland.geo_locations ORDER BY code')).rows;
      const content = {};
      for (const table of ['properties','property_media','videos','events','clubs','consultants']) content[table] = (await c.query(`SELECT * FROM xland.${table} ORDER BY id`)).rows;
      await c.query('COMMIT');
      const result = {timestamp: new Date().toISOString(), fingerprint, readOnly: true, writes: 0,
        metadata, counts, ledger, roles, media, buckets: buckets.rows, locations,
        storage: {urlPresent: !!env.SUPABASE_URL,
          serverCredentialPresent: !!(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY),
          processCredentialPresent: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)}, columns};
      await mkdir(evidenceRoot, {recursive: true});
      await writeFile(resolve(evidenceRoot, 'inventory.json'), JSON.stringify(result, null, 2));
      // Public/synthetic content only; never copy identities, contacts, sessions or private documents.
      try {await writeFile(resolve(evidenceRoot, 'content-before.json'), JSON.stringify(content, null, 2), {flag:'wx'});}
      catch(error){if(error.code!=='EEXIST')throw error;}
      console.log(JSON.stringify({fingerprint,readOnly:true,writes:0,counts,media,buckets:buckets.rows,storage:result.storage}));
      return result;
    } finally { c.release(); }
  } finally { await pool.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  inventory().catch(error => {console.error(JSON.stringify({errorCode:error.code || 'INVENTORY_FAILED', message: error.code ? 'Database inventory failed; no writes' : error.message}));process.exitCode=1;});
}
