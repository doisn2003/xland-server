import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { sharingConfig } from '../../src/sharing/config.js';
import { publicImage, shareUrl } from '../../src/sharing/content.js';
import { shareHtml, sharingRouter } from '../../src/sharing/routes.js';
import { createApp } from '../../src/app.js';
import { CoreService } from '../../src/services/core.js';
import type { Database } from '../../src/repositories/database.js';
import type { AuthService } from '../../src/services/auth.js';
import type { CursorCodec } from '../../src/services/cursor.js';

test('sharing configuration rejects origins that would generate broken or credential-bearing links', () => {
  for (const origin of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/api/v1', 'https://example.com/?token=secret', 'https://localhost']) {
    assert.throws(() => sharingConfig({ PUBLIC_BASE_URL: origin }));
  }
  assert.equal(shareUrl('https://xland.example/', 'videos', 'ABC'), 'https://xland.example/videos/abc');
  assert.throws(() => sharingConfig({ SHARE_ANDROID_SHA256: 'not-a-certificate' }));
  assert.throws(() => sharingConfig({ SHARE_APPLE_APP_ID: 'wrong' }));
});

test('metadata escapes text and contains canonical OG tags in the initial HTML without javascript', () => {
  const html = shareHtml({ title: '<script>alert("x")</script>', description: 'Land & "caption"', image: null, illustrative: true },
    'https://xland.example/videos/id', 'xland://share/videos/id', 'https://xland.example/share/default-preview.png');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:card']) assert.ok(html.includes(tag));
  assert.ok(html.includes('Dữ liệu minh họa'));
  assert.ok(!html.includes('http-equiv="refresh"'));
  assert.ok(html.includes('xland://share/videos/id'));
});

test('private, signed, local or unsupported preview images fall back to the brand image', () => {
  for (const value of [null, 'javascript:alert(1)', 'http://cdn.example/a.png', 'https://user:pass@cdn.example/a.png',
    'https://cdn.example/a.png?token=secret', 'https://127.0.0.1/a.png', 'https://localhost/a.png',
    'https://cdn.example/storage/v1/object/sign/a.png', 'https://cdn.example/private/a.png']) {
    assert.equal(publicImage(value), null);
  }
  assert.equal(publicImage('https://cdn.example/media/a.jpg'), 'https://cdn.example/media/a.jpg');
});

test('association files and default PNG are public, correctly typed and never redirect', async () => {
  // These routes must never need a database or an authenticated session.
  const core = new CoreService({} as Database, {} as AuthService, {} as CursorCodec);
  const fingerprint = Array(32).fill('AB').join(':');
  const config = sharingConfig({ PUBLIC_BASE_URL: 'https://xland.example', SHARE_ANDROID_SHA256: fingerprint,
    SHARE_APPLE_APP_ID: 'TEAMID1234.vn.xland.xlandMobile' });
  const server = createApp({ checkReadiness: async () => true, publicPages: sharingRouter(core, config) }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const android = await fetch(base + '/.well-known/assetlinks.json');
    assert.equal(android.status, 200); assert.ok(android.headers.get('content-type')?.includes('application/json'));
    const links = await android.json() as { target: { sha256_cert_fingerprints: string[]; package_name: string } }[];
    assert.deepEqual(links[0]?.target.sha256_cert_fingerprints, [fingerprint]);
    assert.equal(links[0]?.target.package_name, 'vn.xland.xland_mobile');
    const apple = await fetch(base + '/.well-known/apple-app-site-association');
    assert.equal(apple.status, 200);
    assert.ok((await apple.text()).includes('TEAMID1234.vn.xland.xlandMobile'));
    const png = await fetch(base + '/share/default-preview.png');
    assert.equal(png.status, 200); assert.ok(png.headers.get('content-type')?.includes('image/png'));
    assert.equal(Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal((await fetch(base + '/videos/bad-id')).status, 404);
  } finally { server.close(); await once(server, 'close'); }
});
