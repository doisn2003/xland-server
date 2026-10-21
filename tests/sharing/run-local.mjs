import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { localPostgres } from '../../scripts/local-postgres.mjs';
import { migrate } from '../../src/repositories/migrations.ts';
import { loadFixture, randomTestAccount, seed } from '../../src/repositories/seed.ts';

// Isolated cluster and fresh databases. No .env, DATABASE_URL or shared context.
const local = await localPostgres({ directory: resolve('.local/sharing'), port: 55449 });
const admin = new pg.Client({ connectionString: local.rootUrl });
let pool;
let status = 1;
try {
  await admin.connect();
  for (const file of ['tests/integration/sharing.test.ts']) {
    const name = 'xland_test_sharing_' + randomBytes(6).toString('hex');
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(local.rootUrl); url.pathname = '/' + name;
    pool = new pg.Pool({ connectionString: url.toString() });
    await migrate(pool);
    const fixture = await loadFixture();
    const first = { ...randomTestAccount(), id: String(fixture.sampleTypes.UserProfile.id) };
    const second = randomTestAccount();
    await seed(pool, [first, second]);
    const rls = await pool.query("SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) safe FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='xland' AND c.relkind='r'");
    assert.equal(rls.rows[0].safe, true);
    const contextPath = resolve('.local/sharing', name + '.json');
    await writeFile(contextPath, JSON.stringify({ connectionString: url.toString(), first, second }), { mode: 0o600 });
    status = await new Promise((done, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--test', file], {
        stdio: 'inherit', windowsHide: true,
        env: { ...process.env, XLAND_TEST_CONTEXT: contextPath },
      });
      child.once('error', reject); child.once('exit', code => done(code ?? 1));
    });
    await pool.end(); pool = undefined;
    if (status !== 0) break;
  }
} finally {
  await pool?.end(); await admin.end(); await local.stop();
}
// embedded-postgres' exit hook must not turn a failing test into success.
process.exit(status);
