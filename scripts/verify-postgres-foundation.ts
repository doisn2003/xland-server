import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../src/repositories/migrations.js';
import { seed, loadFixture, randomTestAccount } from '../src/repositories/seed.js';
// Executed only after scripts/local-postgres.mjs has provisioned this private cluster.
const config=JSON.parse(await readFile('.local/cluster.json','utf8')) as {port:number;password:string};
const options={host:'127.0.0.1',port:config.port,user:'postgres',password:config.password};
const admin=new pg.Pool({...options,database:'postgres'});
const name='xland_test_p2_'+randomBytes(8).toString('hex');
await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);await admin.end();
const pool=new pg.Pool({...options,database:name});
try {
  const migrations=await migrate(pool);
  const fixture=await loadFixture();
  const first={...randomTestAccount(),id:String(fixture.sampleTypes.UserProfile!.id)};
  const second=randomTestAccount();
  const before=Date.now();await seed(pool,[first,second]);
  const counts=async()=> (await pool.query(`SELECT (SELECT count(*)::int FROM xland.properties) properties,
    (SELECT count(*)::int FROM xland.videos) videos,(SELECT count(*)::int FROM xland.user_identities) identities,
    (SELECT count(*)::int FROM xland.property_legal_items WHERE status='verified') verified`)).rows[0] as Record<string,number>;
  const once=await counts();await seed(pool,[first,second]);const twice=await counts();
  if(JSON.stringify(once)!==JSON.stringify(twice))throw new Error('Seed replay changed row counts');
  const state={testDatabase:name,environment:'isolated-local-test',version:(await pool.query('SHOW server_version')).rows[0],migrations,once,twice,seedReplayStable:true,seedMilliseconds:Date.now()-before};
  await writeFile('../brain/logs/agent-c/evidence/P2/postgres-foundation.json',JSON.stringify(state,null,2));
  // Private runtime/test coordinates and credentials never enter evidence or stdout.
  await writeFile('.local/test-context.json',JSON.stringify({connectionString:`postgresql://postgres:${config.password}@127.0.0.1:${config.port}/${name}`,first,second}),{mode:0o600});
  console.log(JSON.stringify(state));
}finally{await pool.end();}
