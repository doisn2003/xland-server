import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../schemas/http.js';
import { DomainError } from '../domain/errors.js';
import { mapNotice, type AreaMapPresentation, type AreaMapProvider, type NamedAreaInput } from './area_map_service.js';
import type { GeoapifyConfig } from './geoapify_config.js';
import type { MapStore } from './geoapify_store.js';

const attribution = [
  { label: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  { label: 'Powered by Geoapify', url: 'https://www.geoapify.com/' },
];
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().trim().replace(/^(xa|phuong|thi tran|tinh|thanh pho|city of|province of)\s+/, '')
  .replace(/\s+(province|city)$/, '').replace(/[^a-z0-9]/g, '');
const administrativeType = (text: string) => /^(xã|phường|đặc khu)\s+/iu.exec(text)?.[1]?.toLowerCase();
export function namedArea(input?: NamedAreaInput): { label: string; key: string; commune: string; province: string } | null {
  if (!input || typeof input.commune !== 'string' || typeof input.province !== 'string') return null;
  const commune = input.commune.trim().replace(/\s+/g, ' '), province = input.province.trim().replace(/\s+/g, ' ');
  // Only administrative names, not house numbers, streets, GPS, or arbitrary geocoder queries.
  if (!/^(xã|phường|đặc khu) [\p{L}\p{M}0-9 .'-]{1,90}$/iu.test(commune) ||
      !/^[\p{L}\p{M} .'-]{2,100}$/u.test(province) || !normalize(commune) || !normalize(province)) return null;
  const key = createHash('sha256').update(`vn-named-v3|${administrativeType(commune)}|${normalize(commune)}|${normalize(province)}`).digest('hex');
  return { label: `${commune}, ${province}, Việt Nam`, key, commune, province };
}
const resultSchema = z.object({
  results: z.array(z.object({
    lat: z.number().finite(), lon: z.number().finite(), country_code: z.string(),
    result_type: z.string(), state: z.string().optional(), city: z.string().optional(),
    district: z.string().optional(), suburb: z.string().optional(), county: z.string().optional(),
    name: z.string().optional(), place_id: z.string().optional(), iso3166_2: z.string().optional(),
  }).passthrough()).max(20),
});
const cachedSchema = z.object({
  availability: z.enum(['ready', 'unavailable']),
  latitude: z.number().min(8).max(24).nullable(), longitude: z.number().min(102).max(110).nullable(),
  checkedAt: z.string(),
});
type Resolution = z.infer<typeof cachedSchema>;
export function selectAdministrativeArea(raw: unknown, input: NonNullable<ReturnType<typeof namedArea>>): Resolution {
  const province = normalize(input.province), commune = normalize(input.commune);
  const municipalityCodes: Record<string, string> = { hanoi: 'VN-HN', haiphong: 'VN-HP', danang: 'VN-DN' };
  const candidates = resultSchema.parse(raw).results.filter(r =>
    r.country_code.toLowerCase() === 'vn' && ['city', 'district', 'suburb', 'locality', 'county'].includes(r.result_type) &&
    (normalize(r.state ?? '') === province ||
      ((!r.state || normalize(r.state) === commune) &&
        (normalize(r.city ?? '') === province || (municipalityCodes[province] !== undefined && r.iso3166_2 === municipalityCodes[province])))) &&
    [r.name, r[r.result_type]].some(name => typeof name === 'string' && normalize(name) === commune &&
      (!administrativeType(name) || administrativeType(name) === administrativeType(input.commune))) &&
    r.lat >= 8 && r.lat <= 24 && r.lon >= 102 && r.lon <= 110 && !r.housenumber && !r.street);
  const unique = new Map(candidates.map(r => [r.place_id ?? `${r.lat},${r.lon}`, r]));
  const match = unique.size === 1 ? [...unique.values()][0] : undefined;
  return { availability: match ? 'ready' : 'unavailable', latitude: match?.lat ?? null,
    longitude: match?.lon ?? null, checkedAt: new Date().toISOString() };
}

export class GeoapifyAreaMapService implements AreaMapProvider {
  private readonly pending = new Map<string, Promise<Resolution>>();
  private readonly tiles = new Map<string, { bytes: Buffer; until: number }>();
  private readonly pendingTiles = new Map<string, Promise<Buffer>>();
  private nextRequestAt = 0;
  constructor(readonly config: GeoapifyConfig, private readonly store: MapStore,
    private readonly fetcher: typeof fetch = fetch) {}

  private async request(url: URL, quarterCredits: number): Promise<Response> {
    if (!this.config.enabled) throw new DomainError(503, 'FEATURE_NOT_ENABLED', 'Bản đồ chưa được cấu hình');
    if (!await this.store.reserve(quarterCredits, this.config.dailyCredits)) {
      throw new DomainError(429, 'MAP_DAILY_LIMIT', 'Bản đồ đã đạt hạn mức miễn phí trong ngày. Bạn vẫn có thể mở Google Maps.');
    }
    // Conservative 5 requests/sec per instance; no automatic retry consuming extra credits.
    const delay = Math.max(0, this.nextRequestAt - Date.now());
    this.nextRequestAt = Date.now() + delay + 210;
    if (delay > 0) await new Promise(done => setTimeout(done, delay));
    url.searchParams.set('apiKey', this.config.apiKey);
    try {
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw new Error('Provider rejected request');
      return response;
    } catch {
      // Never expose provider URL, key, raw response, or native fetch error.
      throw new DomainError(503, 'UPSTREAM_UNAVAILABLE', 'Chưa tải được bản đồ. Bạn có thể mở Google Maps.');
    }
  }
  private async resolve(input: NonNullable<ReturnType<typeof namedArea>>): Promise<Resolution> {
    const cached = cachedSchema.safeParse(await this.store.get(input.key));
    if (cached.success) return cached.data;
    let pending = this.pending.get(input.key);
    if (!pending) {
      pending = (async () => {
        const url = new URL('https://api.geoapify.com/v1/geocode/search');
        // Structured city/state avoids the free-text parser treating Vietnamese ward names as streets.
        url.search = new URLSearchParams({ city: input.commune, state: input.province, country: 'Vietnam', type: 'locality', filter: 'countrycode:vn',
          lang: 'vi', limit: '10', format: 'json' }).toString();
        const response = await this.request(url, 4);
        const text = await response.text();
        if (text.length > 100000) throw new Error('Oversized geocoder response');
        const resolved = selectAdministrativeArea(JSON.parse(text), input);
        await this.store.put(input.key, resolved, resolved.availability === 'ready' ? 30 * 86400 : 3600);
        return resolved;
      })().finally(() => this.pending.delete(input.key));
      this.pending.set(input.key, pending);
    }
    return pending;
  }
  async presentation(propertyId: string, location?: NamedAreaInput): Promise<AreaMapPresentation> {
    const input = namedArea(location);
    const external = input ? new URL('https://www.google.com/maps/search/') : null;
    const directions = input ? new URL('https://www.google.com/maps/dir/') : null;
    if (external && input) { external.searchParams.set('api', '1'); external.searchParams.set('query', input.label); }
    if (directions && input) { directions.searchParams.set('api', '1'); directions.searchParams.set('destination', input.label); }
    const base: AreaMapPresentation = {
      propertyId, availability: 'unconfigured', provider: 'none', poiMode: 'none', publicArea: null,
      areaLabel: input?.label ?? null, notice: 'Bản đồ chưa được cấu hình. ' + mapNotice,
      externalAreaMapUrl: external?.toString() ?? null, externalDirectionsUrl: directions?.toString() ?? null,
      tilePathTemplate: null, embedPageUrl: null, attribution: [],
    };
    if (!input) return { ...base, availability: 'invalid_area', notice: 'Chưa có tên xã/phường/đặc khu và tỉnh/thành đầy đủ. ' + mapNotice };
    if (!this.config.enabled) return base;
    try {
      const result = await this.resolve(input);
      if (result.availability !== 'ready' || result.latitude === null || result.longitude === null) {
        return { ...base, availability: 'unavailable', notice: 'Chưa xác định được duy nhất xã/phường/đặc khu này trên bản đồ. ' + mapNotice };
      }
      return { ...base, availability: 'ready', provider: 'geoapify', attribution,
        notice: mapNotice, tilePathTemplate: '/maps/tiles/{z}/{x}/{y}.png',
        publicArea: { id: input.key, label: input.label, centerLatitude: result.latitude,
          centerLongitude: result.longitude, radiusM: 2000, initialZoom: 12, precision: 'administrative_area',
          checkedAt: result.checkedAt, sourceUpdatedAt: null } };
    } catch (error) {
      return { ...base, availability: 'unavailable', notice: error instanceof DomainError ? error.message : 'Chưa tải được khu vực. Bạn có thể mở Google Maps.' };
    }
  }
  async tile(z: number, x: number, y: number): Promise<Buffer> {
    if (!this.config.enabled) throw new DomainError(503, 'FEATURE_NOT_ENABLED', 'Bản đồ chưa được cấu hình');
    const key = `${z}/${x}/${y}`;
    const cached = this.tiles.get(key);
    if (cached && cached.until > Date.now()) return cached.bytes;
    let pending = this.pendingTiles.get(key);
    if (!pending) {
      // Bound queued work; gestures should not cause an unbounded provider queue.
      if (this.pendingTiles.size >= 32) throw new DomainError(429, 'RATE_LIMITED', 'Đang tải bản đồ, hãy thử lại');
      pending = (async () => {
        const response = await this.request(new URL(`https://maps.geoapify.com/v1/tile/osm-carto/${key}.png`), 1);
        if (!response.headers.get('content-type')?.startsWith('image/png')) throw new DomainError(503, 'UPSTREAM_UNAVAILABLE', 'Bản đồ tạm thời không tải được');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 512000 || bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
          throw new DomainError(503, 'UPSTREAM_UNAVAILABLE', 'Dữ liệu bản đồ chưa hợp lệ');
        }
        if (this.tiles.size >= 256) this.tiles.delete(this.tiles.keys().next().value!);
        this.tiles.set(key, { bytes, until: Date.now() + 3600000 });
        return bytes;
      })().finally(() => this.pendingTiles.delete(key));
      this.pendingTiles.set(key, pending);
    }
    return pending;
  }
}

export function geoapifyTileRouter(maps: GeoapifyAreaMapService): Router {
  const router = Router();
  router.get('/maps/tiles/:z/:x/:y.png', async (req, res) => {
    parse(z.object({}).strict(), req.query);
    const level = parse(z.coerce.number().int().min(6).max(16), req.params.z);
    const coordinate = z.coerce.number().int().min(0).max(2 ** level - 1);
    const x = parse(coordinate, req.params.x), y = parse(coordinate, req.params.y);
    const bytes = await maps.tile(level, x, y);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('image/png').send(bytes);
  });
  return router;
}
