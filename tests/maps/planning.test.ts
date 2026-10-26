import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { PoolClient } from 'pg';
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import type { CoreService } from '../../src/services/core.js';
import type { AreaMapPresentation, NamedAreaInput } from '../../src/maps/area_map_service.js';
import { areaMapApiRouter } from '../../src/maps/map_routes.js';
import { planningConfig, planningRegion, PlanningMapService, PlanningAreaMapProvider, planningTileRouter } from '../../src/maps/planning_maps.js';

const input: NamedAreaInput = { commune: 'Phường Long Biên', province: 'Hà Nội',
  provinceCode: '01', catalogVersion: 'test-version', catalogProvince: 'Thành phố Hà Nội' };
const config = () => planningConfig({ MAPS_PLANNING_ENABLED: 'true' });
// A generated, transparent 256px PNG. Its emptiness must never imply "no planning".
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAEVSURBVHhe7cExAQAAAMKg9U/tawigAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AwE8AAFBxdM7AAAAAElFTkSuQmCC', 'base64');
const response = () => new Response(png, { headers: { 'content-type': 'image/png' } });
const base: AreaMapPresentation = { propertyId: '10000000-0000-4000-8000-000000000001', availability: 'ready',
  publicArea: null, provider: 'geoapify', poiMode: 'none', attribution: [], notice: 'Area only',
  externalAreaMapUrl: null, embedPageUrl: null };

test('planning gates on the catalog-backed property province, not address substrings', () => {
  assert.equal(planningRegion(input), 'ha-noi');
  assert.equal(planningRegion({ ...input, province: 'TP. Hải Phòng', catalogProvince: 'Hải Phòng', provinceCode: '31' }), 'hai-phong');
  for (const data of [undefined, { ...input, provinceCode: '' }, { ...input, catalogVersion: '' },
    { ...input, catalogProvince: null }, { ...input, province: 'Hải Phòng' },
    { ...input, province: 'Hà Nội mở rộng', catalogProvince: 'Hà Nội mở rộng' },
    { ...input, province: 'Đà Nẵng', catalogProvince: 'Đà Nẵng' }]) assert.equal(planningRegion(data), null);
});

test('disabled/missing source and unavailable base are explicit; no upstream access for metadata', async () => {
  const service = new PlanningMapService(config(), async () => { throw new Error('No metadata fetch expected'); });
  const meta = service.presentation(input, true);
  assert.equal(meta.availability, 'ready');
  assert.equal(meta.source?.minZoom, 10);
  assert.equal(meta.source?.publishedAt, null);
  assert.equal(meta.source?.coverageBounds, null);
  assert.ok(!JSON.stringify(meta).includes('quy-hoach.bds68.com.vn'));
  assert.equal(service.presentation(input, false).availability, 'unavailable');
  assert.equal(service.presentation(undefined, true).availability, 'not_supported');
  assert.equal(new PlanningMapService(planningConfig({})).presentation(input, true).availability, 'unconfigured');
  const result = await new PlanningAreaMapProvider({ presentation: () => base }, service).presentation(base.propertyId, input);
  assert.equal(result.provider, base.provider);
  assert.equal(result.planning?.region, 'ha-noi');
  assert.equal(result.publicArea, base.publicArea);
});

test('manifest validates placeholders, source bounds, revisions, HTTPS and zoom ranges; invalid config fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xland-planning-'));
  const path = join(dir, 'sources.json');
  const source = config().sources['ha-noi']!;
  try {
    for (const bad of [{ ...source, tileUrlTemplate: 'http://localhost/{z}/{x}/{y}.png' },
      { ...source, tileUrlTemplate: 'https://tiles.test/{z}/{x}/{y}/{other}.png' },
      { ...source, revision: '../evil' }, { ...source, minZoom: 19 },
      { ...source, coverageBounds: [21, 106, 20, 105] }, { ...source, sourceUrl: 'javascript:alert(1)' }]) {
      writeFileSync(path, JSON.stringify({ 'ha-noi': bad }));
      assert.equal(planningConfig({ MAPS_PLANNING_ENABLED: 'true', MAPS_PLANNING_MANIFEST: path }).enabled, false);
    }
    writeFileSync(path, JSON.stringify({ 'ha-noi': { ...source, revision: 'reviewed-v2', publishedAt: '2026-01-01T00:00:00Z' } }));
    const valid = planningConfig({ MAPS_PLANNING_ENABLED: 'true', MAPS_PLANNING_MANIFEST: path });
    assert.equal(valid.enabled, true);
    assert.equal(valid.sources['ha-noi']?.revision, 'reviewed-v2');
    assert.equal(new PlanningMapService(valid).presentation({ ...input, province: 'Hải Phòng', catalogProvince: 'Hải Phòng' }, true).availability, 'unconfigured');
  } finally { rmSync(path, { force: true }); rmdirSync(dir); }
});

test('tiles coalesce/cache, fixed XYZ URL, no referrer spoofing or identity headers', async () => {
  let calls = 0;
  const service = new PlanningMapService(config(), async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://quy-hoach.bds68.com.vn/Ha-Noi/12/3249/1803.png');
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.headers, undefined);
    return response();
  });
  const images = await Promise.all([service.tile('ha-noi', 'bds68-unversioned', 12, 3249, 1803), service.tile('ha-noi', 'bds68-unversioned', 12, 3249, 1803)]);
  assert.deepEqual(images[0], png);
  await service.tile('ha-noi', 'bds68-unversioned', 12, 3249, 1803);
  assert.equal(calls, 1);
});

test('missing tiles are negative-cached, outages not cached, provider details redacted', async () => {
  let calls = 0;
  const missing = new PlanningMapService(config(), async () => { calls++; return new Response(null, { status: 404 }); });
  for (let i = 0; i < 2; i++) await assert.rejects(missing.tile('ha-noi', 'bds68-unversioned', 12, 3249, 1803), { code: 'PLANNING_TILE_MISSING' });
  assert.equal(calls, 1);
  calls = 0;
  const broken = new PlanningMapService(config(), async () => { calls++; throw new Error('PRIVATE_TOKEN'); });
  for (let i = 0; i < 2; i++) await assert.rejects(broken.tile('ha-noi', 'bds68-unversioned', 12, 3249, 1803), error => {
    assert.ok(error instanceof Error && !error.message.includes('PRIVATE_TOKEN')); return true;
  });
  assert.equal(calls, 2);
});

test('reject wrong content/dimensions and bound streaming responses even without Content-Length', async () => {
  const wrongSize = Buffer.from(png); wrongSize.writeUInt32BE(1, 16);
  for (const makeResponse of [() => new Response('html', { headers: { 'content-type': 'text/html' } }),
    () => new Response(wrongSize, { headers: { 'content-type': 'image/png' } }),
    () => new Response(new Uint8Array(512001), { headers: { 'content-type': 'image/png' } })]) {
    const service = new PlanningMapService(config(), async () => makeResponse());
    await assert.rejects(service.tile('ha-noi', 'bds68-unversioned', 12, 3249, 1803), { code: 'PLANNING_UNAVAILABLE' });
  }
});

test('bounds and revisions prevent requests outside coverage; zero cache policy is honored', async () => {
  const settings = config();
  settings.sources['ha-noi']!.coverageBounds = [20.9, 105.5, 21.1, 105.9];
  settings.sources['ha-noi']!.cacheSeconds = 0;
  let calls = 0;
  const service = new PlanningMapService(settings, async () => { calls++; return response(); });
  await assert.rejects(service.tile('ha-noi', 'old-revision', 12, 3249, 1803), { code: 'PLANNING_TILE_MISSING' });
  await assert.rejects(service.tile('ha-noi', 'bds68-unversioned', 12, 3261, 1805), { code: 'PLANNING_TILE_MISSING' });
  await assert.rejects(service.tile('ha-noi', 'bds68-unversioned', 19, 3249, 1803), { code: 'INVALID_INPUT' });
  assert.equal(calls, 0);
  await service.tile('ha-noi', 'bds68-unversioned', 12, 3249, 1803);
  await service.tile('ha-noi', 'bds68-unversioned', 12, 3249, 1803);
  assert.equal(calls, 2);
});

test('HTTP routes reject arbitrary URLs/regions/coordinates and preserve property read permissions', async () => {
  const service = new PlanningMapService(config(), async () => response());
  let reads = 0;
  const core: Pick<CoreService, 'read'> = { async read(identity, work) {
    reads++; assert.equal(identity, undefined);
    return work({ query: async (sql: string, values: string[]) => {
      assert.match(sql, /g.catalog_version=p.catalog_version/);
      assert.ok(!/p\.(lat|lng|approximate_lat|approximate_lng)\b/.test(sql));
      return { rowCount: values[0] === base.propertyId ? 1 : 0, rows: [{ id: base.propertyId, ...input }] };
    } } as unknown as PoolClient);
  } };
  const server = createApp({ checkReadiness: async () => true,
    publicPages: planningTileRouter(service), api: areaMapApiRouter(core, new PlanningAreaMapProvider({ presentation: () => base }, service)) }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const tile = await fetch(`${origin}/maps/planning/ha-noi/bds68-unversioned/12/3249/1803.png`);
    assert.equal(tile.status, 200); assert.equal(tile.headers.get('cache-control'), 'public, max-age=3600');
    for (const path of ['da-nang/bds68-unversioned/12/3249/1803.png', 'ha-noi/bds68-unversioned/20/1/1.png',
      'ha-noi/bds68-unversioned/12/4096/1803.png', 'ha-noi/bds68-unversioned/12/3249/1803.png?url=https://evil.test']) {
      assert.equal((await fetch(`${origin}/maps/planning/${path}`)).status, 400);
    }
    const metadata = await fetch(`${origin}/api/v1/properties/${base.propertyId}/area-map`);
    assert.equal(metadata.status, 200);
    const body = await metadata.json() as { data: AreaMapPresentation };
    assert.equal(body.data.planning?.region, 'ha-noi');
    assert.equal((await fetch(`${origin}/api/v1/properties/10000000-0000-4000-8000-000000000099/area-map`)).status, 404);
    assert.equal(reads, 2);
  } finally { server.close(); await once(server, 'close'); }
});
