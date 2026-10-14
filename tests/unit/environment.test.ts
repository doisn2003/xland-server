import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvironment } from '../../src/config/environment.js';

test('valid environment and Railway port', () => {
  assert.equal(parseEnvironment({ PORT: '8080', NODE_ENV: 'test' }).port, 8080);
});
test('invalid environment fails without echoing secrets', () => {
  for (const PORT of ['NaN', '0', '65536', '1.5', '12junk']) {
    assert.throws(() => parseEnvironment({ PORT }), /PORT is invalid/);
  }
  assert.throws(() => parseEnvironment({ NODE_ENV: 'production' }), /required/);
  assert.throws(() => parseEnvironment({ DATABASE_URL: 'secret-value' }), /^Error: DATABASE_URL is invalid$/);
  assert.throws(() => parseEnvironment({ NODE_ENV: 'unknown' }), /NODE_ENV/);
});
