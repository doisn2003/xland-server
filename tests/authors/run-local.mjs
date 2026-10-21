import {localPostgres} from '../../scripts/local-postgres.mjs';
import {runLocalChild} from '../../scripts/run-local-child.mjs';
import {migrate} from '../../src/repositories/migrations.ts';
import {seed,loadFixture,randomTestAccount} from '../../src/repositories/seed.ts';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

// No .env or shared DATABASE_URL: use a fresh database on an owned local cluster.
const local=await localPostgres({directory:resolve('.local/author-profiles'),port:55445});
const name='xland_test_authors_'+randomBytes(6).toString('hex');
const admin=new pg.Client({connectionString:local.rootUrl});
let pool;
let stage='setup';
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  const url=new URL(local.rootUrl);url.pathname='/'+name;
  pool=new pg.Pool({connectionString:url.toString()});
  stage='migrations';await migrate(pool);
  const fixture=await loadFixture();
  const first={...randomTestAccount(),id:String(fixture.sampleTypes.UserProfile.id)};
  const second=randomTestAccount();
  stage='seed';await seed(pool,[first,second]);
  process.env.XLAND_TEST_CONTEXT=resolve('.local/author-profiles/test-context.json');
  await writeFile(process.env.XLAND_TEST_CONTEXT,JSON.stringify({connectionString:url.toString(),first,second}),{mode:0o600});
  console.log('Author regression: current migrations and fixtures ready in an isolated UTF-8 test database.');
  stage='regression';
  await runLocalChild(['--import','tsx','--test','tests/integration/author-profile.test.ts']).done;
} catch(e) {
  console.error(JSON.stringify({stage,code:e.code??'AUTHOR_PROFILE_TEST_FAILED'}));
  process.exitCode=1;
} finally {
  await pool?.end();
  await admin.end();
  await local.stop();
}
process.exit(process.exitCode??0);
