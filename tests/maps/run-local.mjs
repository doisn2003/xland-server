import {localPostgres} from '../../scripts/local-postgres.mjs';
import {migrate} from '../../src/repositories/migrations.ts';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import pg from 'pg';

// Never read shared DATABASE_URL or .env; preserve the isolated test DB after checks.
const local=await localPostgres({directory:resolve('.local/maps-tests'),port:55442});
const name='xland_test_maps_'+randomBytes(6).toString('hex');
const admin=new pg.Client({connectionString:local.rootUrl});
let pool,code=1;
try {
  await admin.connect();await admin.query(`CREATE DATABASE ${name}`);
  const url=new URL(local.rootUrl);url.pathname='/'+name;
  pool=new pg.Pool({connectionString:url.toString()});
  console.log(JSON.stringify({isolated:true,applied:await migrate(pool)}));
  if((await migrate(pool)).length)throw new Error('Migration replay failed');
  code=await new Promise((done,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','--test','tests/maps/database.test.ts'],{
      stdio:'inherit',windowsHide:true,env:{...process.env,XLAND_MAPS_TEST_DB:url.toString()}});
    child.once('error',reject);child.once('exit',value=>done(value??1));
  });
} finally {await pool?.end();await admin.end();await local.stop();}
process.exit(code);
