import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/app.js';

test('health, errors and request identity do not claim DB readiness', async () => {
  const server = createApp({ checkReadiness: async () => false }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${url}/health/live`)).status, 200);
    assert.equal((await fetch(`${url}/health/ready`)).status, 503);
    const missing = await fetch(`${url}/api/v1/properties`);
    assert.equal(missing.status, 404);
    const body = await missing.json() as { requestId: string; error: { code: string } };
    assert.equal(body.requestId, missing.headers.get('x-request-id'));
    assert.equal(body.error.code, 'NOT_FOUND');
    const invalid = await fetch(`${url}/not-found`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(invalid.status, 400);
    const text = await invalid.text();
    assert.ok(text.includes('INVALID_INPUT'));
    assert.ok(!text.includes('SyntaxError'));
  } finally {
    server.close();
    await once(server, 'close');
  }
});
