import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApi } from '../helpers/api.js';
import type { Wire } from '../../src/repositories/properties.js';
import { assertWire } from '../helpers/wire.js';

test('share API and crawler HTML use the same public records; private/removed records stay unavailable', async () => {
  const api = await testApi();
  const origin = api.base.replace('/api/v1', '');
  try {
    const property = ((await api.request('/properties')).body.data as Wire[])[0]!;
    const video = ((await api.request('/feed')).body.data as Wire[])[0]!;
    const event = ((await api.request('/events')).body.data as Wire[])[0]!;
    const token = await api.login();
    for (const [kind, record] of [['properties', property], ['videos', video], ['events', event]] as const) {
      const shared = await api.request(`/${kind}/${record.id}/share`);
      assert.equal(shared.status, 200);
      assertWire(shared.body.data, 'ShareLink');
      assert.deepEqual((await api.request(`/${kind}/${record.id}/share`, 'GET', undefined, token)).body.data, shared.body.data);
      const link = shared.body.data as { url: string; title: string };
      assert.equal(link.url, `https://xland.example.test/${kind}/${record.id}`);
      const page = await fetch(origin + new URL(link.url).pathname + '?utm_source=chat', {
        headers: { 'User-Agent': 'facebookexternalhit/1.1', Authorization: 'Bearer invalid-ignored-on-public-page' },
      });
      assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store');
      assert.ok(page.headers.get('content-type')?.includes('text/html'));
      const html = await page.text();
      assert.ok(html.includes('property="og:title"')); assert.ok(html.includes(link.url));
      assert.ok(!html.includes('utm_source')); assert.ok(!html.includes('invalid-ignored'));
      for (const field of ['contact_phone', 'contactPhone', 'exact_lat', 'storage_key', 'accessToken']) assert.ok(!html.includes(field));
      const head = await fetch(origin + new URL(link.url).pathname, { method: 'HEAD' });
      assert.equal(head.status, 200); assert.equal(await head.text(), '');
    }

    const propertyId = String(video.propertyId);
    const mediaId = (video.media as Wire).id;
    await api.db.pool.query('UPDATE xland.property_media SET thumbnail_url=$2 WHERE id=$1', [mediaId, 'https://cdn.example.com/video-poster.jpg']);
    assert.ok((await (await fetch(`${origin}/videos/${video.id}`)).text()).includes('https://cdn.example.com/video-poster.jpg'));
    await api.db.pool.query('UPDATE xland.property_media SET thumbnail_url=$2 WHERE id=$1', [mediaId, 'https://cdn.example.com/video-poster.jpg?token=secret']);
    const fallback = await (await fetch(`${origin}/videos/${video.id}`)).text();
    assert.ok(fallback.includes('/share/default-preview.png')); assert.ok(!fallback.includes('token=secret'));
    // Mutations affect only the freshly provisioned, isolated local test DB.
    await api.db.pool.query('UPDATE xland.properties SET title=$2 WHERE id=$1', [propertyId, '<script>malicious</script> & "quoted"']);
    const escaped = await (await fetch(`${origin}/videos/${video.id}`)).text();
    assert.ok(!escaped.includes('<script>malicious</script>'));
    assert.ok(escaped.includes('&lt;script&gt;malicious&lt;/script&gt;'));
    await api.db.pool.query("UPDATE xland.properties SET status='paused' WHERE id=$1", [propertyId]);
    assert.equal((await fetch(`${origin}/properties/${propertyId}`)).status, 404);
    assert.equal((await fetch(`${origin}/videos/${video.id}`)).status, 404);
    assert.equal((await api.request(`/videos/${video.id}/share`)).status, 404);
    await api.db.pool.query("UPDATE xland.properties SET status='listed',approval_status='pending' WHERE id=$1", [propertyId]);
    assert.equal((await fetch(`${origin}/properties/${propertyId}`)).status, 404);
    await api.db.pool.query("UPDATE xland.properties SET approval_status='approved' WHERE id=$1", [propertyId]);
    await api.db.pool.query('UPDATE xland.videos SET deleted_at=now() WHERE id=$1', [video.id]);
    const removed = await fetch(`${origin}/videos/${video.id}`);
    assert.equal(removed.status, 404); assert.ok(!(await removed.text()).includes('og:image'));
    assert.equal((await fetch(`${origin}/properties/00000000-0000-4000-8000-000000009999`)).status, 404);
  } finally { await api.close(); }
});
