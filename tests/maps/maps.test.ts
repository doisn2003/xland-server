import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PoolClient } from 'pg';
import { Router } from 'express';
import { createApp } from '../../src/app.js';
import { DomainError } from '../../src/domain/errors.js';
import type { CoreService } from '../../src/services/core.js';
import { PublicAreaCatalog, loadPublicAreaCatalog } from '../../src/maps/area_catalog.js';
import { embedConfigFromEnv } from '../../src/maps/embed_config.js';
import { AreaMapService } from '../../src/maps/area_map_service.js';
import { areaMapApiRouter, areaMapPageRouter } from '../../src/maps/map_routes.js';

const propertyA = '10000000-0000-4000-8000-000000000001';
const propertyB = '10000000-0000-4000-8000-000000000002';
const missingId = '10000000-0000-4000-8000-000000000099';
const sampleArea = {
  id: 'test-public-area', label: 'Khu vực thử nghiệm, Tỉnh kiểm thử', provinceLabel: 'Tỉnh kiểm thử',
  centerLatitude: 21, centerLongitude: 105, radiusM: 2000, initialZoom: 12,
  precision: 'administrative_area', sourceUrl: 'https://source.example/area',
  checkedAt: '2026-10-19T00:00:00Z', sourceUpdatedAt: null, publicUseApproved: true,
};
const input = () => ({ version: 1, areas: [{ ...sampleArea }], properties: [{ propertyId: propertyA, areaId: sampleArea.id }, { propertyId: propertyB, areaId: sampleArea.id }] });
const enabledEnv = {
  MAPS_EMBED_ENABLED: 'true', MAPS_EMBED_API_KEY: 'SYNTHETIC_TEST_KEY_12345',
  MAPS_WRAPPER_ORIGIN: 'https://maps.xland.test', MAPS_WEB_ORIGINS: 'https://app.xland.test',
  MAPS_EMBED_RESTRICTIONS_CONFIRMED: 'true',
};
const maps = () => new AreaMapService(embedConfigFromEnv(enabledEnv), new PublicAreaCatalog(input()));
async function wrapperFetch(url: string) {
  return new Promise<{ status: number; text: string; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const request = httpRequest(url, { headers: { Host: 'maps.xland.test' } }, response => {
      let text = '';
      response.setEncoding('utf8'); response.on('data', (chunk: string) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text, headers: response.headers }));
    });
    request.on('error', reject); request.end();
  });
}

test('configuration defaults off and never exposes an unapproved key', () => {
  assert.equal(embedConfigFromEnv({}).enabled, false);
  for (const patch of [
    { MAPS_WRAPPER_ORIGIN: 'http://maps.xland.test' },
    { MAPS_WRAPPER_ORIGIN: 'https://maps.xland.test/secret' },
    { MAPS_WRAPPER_ORIGIN: 'https://user:pass@maps.xland.test' },
    { MAPS_WEB_ORIGINS: 'javascript:alert(1)' },
    { MAPS_EMBED_RESTRICTIONS_CONFIRMED: 'false' },
    { MAPS_EMBED_API_KEY: '' },
  ]) {
    const config = embedConfigFromEnv({ ...enabledEnv, ...patch });
    assert.equal(config.enabled, false);
    assert.equal(config.apiKey, '');
  }
});

test('HTTP origins only in explicit non-production loopback development mode', () => {
  const dev = { ...enabledEnv, MAPS_ALLOW_LOCAL_HTTP: 'true', MAPS_WRAPPER_ORIGIN: 'http://10.0.2.2:3002', MAPS_WEB_ORIGINS: 'http://localhost:5557' };
  assert.equal(embedConfigFromEnv(dev).enabled, true);
  assert.equal(embedConfigFromEnv({ ...dev, NODE_ENV: 'production' }).enabled, false);
  assert.equal(embedConfigFromEnv({ ...dev, MAPS_ALLOW_LOCAL_HTTP: 'false' }).enabled, false);
  assert.equal(embedConfigFromEnv({ ...dev, MAPS_WRAPPER_ORIGIN: 'http://evil.test' }).enabled, false);
});

test('operator catalog rejects unreviewed/exact fields, duplicate or dangling bindings', async () => {
  assert.throws(() => new PublicAreaCatalog({ ...input(), areas: [{ ...sampleArea, publicUseApproved: false }] }));
  assert.throws(() => new PublicAreaCatalog({ ...input(), areas: [{ ...sampleArea, precision: 'parcel' }] }));
  assert.throws(() => new PublicAreaCatalog({ ...input(), areas: [{ ...sampleArea, exactLatitude: 21.123456 }] }));
  assert.throws(() => new PublicAreaCatalog({ ...input(), areas: [{ ...sampleArea, centerLatitude: NaN }] }));
  assert.throws(() => new PublicAreaCatalog({ ...input(), properties: [{ propertyId: propertyA, areaId: 'unknown' }] }));
  assert.throws(() => new PublicAreaCatalog({ ...input(), areas: [sampleArea, sampleArea] }));
  assert.equal((await loadPublicAreaCatalog('nonexistent-maps-catalog.json')).invalid, true);
});

test('same area has identical public map context, no property marker/key/source leakage', () => {
  const service = maps();
  const a = service.presentation(propertyA), b = service.presentation(propertyB);
  assert.equal(a.availability, 'ready');
  assert.deepEqual(a.publicArea, b.publicArea);
  assert.equal(a.embedPageUrl, b.embedPageUrl);
  const wire = JSON.stringify(a);
  assert.ok(!wire.includes(enabledEnv.MAPS_EMBED_API_KEY));
  assert.ok(!wire.includes('sourceUrl'));
  assert.equal(new URL(a.externalAreaMapUrl!).searchParams.get('query'), sampleArea.label);
  const view = service.googleUrl(service.catalog.get(sampleArea.id)!, 'all');
  assert.equal(view.pathname, '/maps/embed/v1/view');
  assert.equal(view.searchParams.get('center'), '21,105');
  assert.equal(view.searchParams.has('q'), false);
  for (const category of ['school', 'hospital', 'park'] as const) {
    const search = service.googleUrl(service.catalog.get(sampleArea.id)!, category);
    assert.equal(search.pathname, '/maps/embed/v1/search');
    assert.ok(search.searchParams.get('q')?.includes(sampleArea.label));
    assert.ok(!search.toString().includes(propertyA));
  }
  const disabled = new AreaMapService(embedConfigFromEnv({}), service.catalog).presentation(propertyA);
  assert.equal(disabled.embedPageUrl, null);
  assert.equal(disabled.provider, 'none');
  assert.ok(disabled.externalAreaMapUrl);
  assert.equal(service.presentation(missingId).availability, 'unavailable');
});

test('AM01 preserves normal read identity, validates query/id, checks existence even when disabled', async () => {
  const identities: unknown[] = [];
  const core: Pick<CoreService, 'read'> = {
    async read(identity, work) {
      identities.push(identity);
      const client = { query: async (_sql: string, values: string[]) => ({ rowCount: values[0] === missingId ? 0 : 1 }) } as unknown as PoolClient;
      return work(client);
    },
  };
  const router = Router();
  router.use((req, res, next) => {
    if (req.headers.authorization) throw new DomainError(401, 'UNAUTHENTICATED', 'Invalid session');
    res.locals.identity = null; next();
  });
  router.use(areaMapApiRouter(core, new AreaMapService(embedConfigFromEnv({}), new PublicAreaCatalog())));
  const server = createApp({ checkReadiness: async () => false, api: router }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/properties`;
  try {
    const result = await fetch(`${base}/${propertyA}/area-map`);
    assert.equal(result.status, 200);
    assert.equal((await result.json() as { data: { availability: string } }).data.availability, 'unconfigured');
    assert.equal((await fetch(`${base}/${missingId}/area-map`)).status, 404);
    assert.equal((await fetch(`${base}/not-uuid/area-map`)).status, 400);
    assert.equal((await fetch(`${base}/${propertyA}/area-map?ownerId=anything`)).status, 400);
    assert.equal((await fetch(`${base}/${propertyA}/area-map`, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
    assert.deepEqual(identities, [null, null]);
  } finally { server.close(); await once(server, 'close'); }
});

test('HTTPS-origin wrapper view/search is strict, escaped, no fake referrer and no private input', async () => {
  const service = maps();
  const server = createApp({ checkReadiness: async () => false, api: areaMapPageRouter(service) }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/maps/embed/${sampleArea.id}`;
  try {
    const view = await wrapperFetch(base);
    assert.equal(view.status, 200);
    const html = view.text;
    assert.ok(html.includes('/maps/embed/v1/view?'));
    assert.ok(html.includes('referrerpolicy="strict-origin-when-cross-origin"'));
    assert.ok(html.includes('min-height:200px'));
    assert.ok(!html.includes(propertyA));
    assert.ok(String(view.headers['content-security-policy']).includes("frame-ancestors 'self' https://app.xland.test"));
    assert.ok(String(view.headers['permissions-policy']).includes('geolocation=()'));
    assert.equal(view.headers['cache-control'], 'no-store');
    const search = await wrapperFetch(base + '?category=hospital');
    assert.ok(search.text.includes('/maps/embed/v1/search?'));
    assert.equal((await wrapperFetch(base + '?url=https://evil.test')).status, 400);
    assert.equal((await wrapperFetch(base + '?category=directions')).status, 400);
    assert.equal((await fetch(base)).status, 421);
    const badArea = { ...input(), areas: [{ ...sampleArea, label: '<script>attack</script>, Tỉnh kiểm thử' }] };
    const evil = new AreaMapService(service.config, new PublicAreaCatalog(badArea));
    assert.ok(!evil.googleUrl(evil.catalog.get(sampleArea.id)!, 'school').toString().includes('<script>'));
  } finally { server.close(); await once(server, 'close'); }
});
