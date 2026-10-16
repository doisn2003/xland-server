import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { databaseTarget } from '../../src/config/database-target.js';
test('database classification/isolation fails closed without exposing a URI or credentials',()=>{
  const testUrl='postgresql://example:private-placeholder@127.0.0.1:55439/xland_test_guard';
  assert.equal(databaseTarget({TEST_DATABASE_URL:testUrl,TEST_DATABASE_ENVIRONMENT:'test'},true).environment,'test');
  for(const env of [{TEST_DATABASE_URL:testUrl},{TEST_DATABASE_URL:testUrl,TEST_DATABASE_ENVIRONMENT:'production'},{TEST_DATABASE_URL:testUrl,DATABASE_URL:testUrl,TEST_DATABASE_ENVIRONMENT:'test'},{TEST_DATABASE_URL:testUrl.replace('xland_test_guard','shared'),TEST_DATABASE_ENVIRONMENT:'test'}])assert.throws(()=>databaseTarget(env,true));
  assert.throws(()=>databaseTarget({DATABASE_URL:'sensitive-invalid-config',DATABASE_ENVIRONMENT:'development'},false),/^Error: Invalid database target$/);
  const dev='postgresql://example:private-placeholder@127.0.0.1/xland_dev_guard';
  assert.throws(()=>databaseTarget({DATABASE_URL:dev,DATABASE_ENVIRONMENT:'development'},false),/fingerprint/);
  const fingerprint=createHash('sha256').update('127.0.0.1/xland_dev_guard').digest('hex').slice(0,16);
  assert.equal(databaseTarget({DATABASE_URL:dev,DATABASE_ENVIRONMENT:'development',DATABASE_APPROVED_FINGERPRINT:fingerprint},false).fingerprint,fingerprint);
});
