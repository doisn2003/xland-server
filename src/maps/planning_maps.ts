import { readFileSync } from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { DomainError } from '../domain/errors.js';
import { parse } from '../schemas/http.js';
import type { AreaMapProvider, AreaMapPresentation, NamedAreaInput } from './area_map_service.js';

const regionSchema = z.enum(['ha-noi', 'hai-phong']);
export type PlanningRegion = z.infer<typeof regionSchema>;
const revisionSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const httpsUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
});
const boundsSchema = z.tuple([z.number().min(8).max(24), z.number().min(102).max(110),
  z.number().min(8).max(24), z.number().min(102).max(110)])
  .refine(([south, west, north, east]) => south < north && west < east);
const sourceSchema = z.object({
  label: z.string().trim().min(1).max(120),
  sourceUrl: httpsUrl,
  legendUrl: httpsUrl.nullable().default(null),
  revision: revisionSchema,
  // Upstream URLs stay on the server; only fixed XYZ coordinates can be substituted.
  tileUrlTemplate: z.string().max(2048).refine(value => {
    if (!['{z}', '{x}', '{y}'].every(token => value.split(token).length === 2)) return false;
    const substituted = value.replace('{z}', '12').replace('{x}', '3250').replace('{y}', '1800');
    return !/[{}]/.test(substituted) && httpsUrl.safeParse(substituted).success &&
      new URL(substituted).pathname.endsWith('.png');
  }),
  minZoom: z.number().int().min(6).max(18),
  maxNativeZoom: z.number().int().min(6).max(19),
  publishedAt: z.iso.datetime().nullable().default(null),
  coverageBounds: boundsSchema.nullable().default(null),
  cacheSeconds: z.number().int().min(0).max(86400).default(3600),
}).strict().refine(value => value.minZoom <= value.maxNativeZoom);
export type PlanningSource = z.infer<typeof sourceSchema>;
const manifestSchema = z.object({ 'ha-noi': sourceSchema.optional(), 'hai-phong': sourceSchema.optional() }).strict();
export interface PlanningConfig {
  enabled: boolean;
  sources: Partial<Record<PlanningRegion, PlanningSource | undefined>>;
}

/** Observed public BDS68 endpoints, not a claim of licensed or complete coverage. */
export function planningConfig(env: NodeJS.ProcessEnv): PlanningConfig {
  if (env.MAPS_PLANNING_ENABLED !== 'true') return { enabled: false, sources: {} };
  try {
    if (env.MAPS_PLANNING_MANIFEST) {
      const bytes = readFileSync(env.MAPS_PLANNING_MANIFEST);
      if (bytes.length > 32768) throw new Error('Oversized planning manifest');
      return { enabled: true, sources: manifestSchema.parse(JSON.parse(bytes.toString('utf8'))) };
    }
    const sources: PlanningConfig['sources'] = {};
    for (const [region, folder, minZoom] of [['ha-noi', 'Ha-Noi', 10], ['hai-phong', 'Hai-Phong', 12]] as const) {
      sources[region] = sourceSchema.parse({
        label: 'BDS68', sourceUrl: `https://bds68.com.vn/quy-hoach/${region}`,
        legendUrl: `https://bds68.com.vn/quy-hoach/${region}`,
        revision: 'bds68-unversioned',
        tileUrlTemplate: `https://quy-hoach.bds68.com.vn/${folder}/{z}/{x}/{y}.png`,
        minZoom, maxNativeZoom: 18,
      });
    }
    return { enabled: true, sources };
  } catch {
    // A bad overlay configuration must not take down the base map or API.
    return { enabled: false, sources: {} };
  }
}

const normalizedProvince = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim().replace(/^(thanh pho|tp\.?|tinh)\s+/, '').replace(/\s+/g, ' ');
/** Resolve from the property's catalog FK, never from viewport or an address substring. */
export function planningRegion(input?: NamedAreaInput): PlanningRegion | null {
  if (!input?.provinceCode || !input.catalogVersion || !input.catalogProvince) return null;
  const province = normalizedProvince(input.catalogProvince);
  if (normalizedProvince(input.province) !== province) return null;
  return province === 'ha noi' ? 'ha-noi' : province === 'hai phong' ? 'hai-phong' : null;
}

export interface PlanningPresentation {
  availability: 'ready' | 'not_supported' | 'unconfigured' | 'unavailable';
  region: PlanningRegion | null;
  notice: string;
  source: null | {
    label: string; sourceUrl: string; legendUrl: string | null; revision: string;
    tilePathTemplate: string; minZoom: number; maxNativeZoom: number;
    publishedAt: string | null; coverageBounds: PlanningSource['coverageBounds'];
  };
}

export class PlanningAreaMapProvider implements AreaMapProvider {
  constructor(private readonly base: AreaMapProvider, private readonly planning: PlanningMapService) {}
  async presentation(propertyId: string, input?: NamedAreaInput): Promise<AreaMapPresentation> {
    const base = await this.base.presentation(propertyId, input);
    return { ...base, planning: this.planning.presentation(input, base.availability === 'ready') };
  }
}

const unavailable = () => new DomainError(503, 'PLANNING_UNAVAILABLE', 'Chưa tải được lớp quy hoạch. Bản đồ nền vẫn sử dụng được.');
const noTile = () => new DomainError(404, 'PLANNING_TILE_MISSING', 'Chưa có ảnh quy hoạch ở ô bản đồ này.');
const MAX_BYTES = 512000;

export class PlanningMapService {
  private readonly pending = new Map<string, Promise<Buffer>>();
  private readonly cache = new Map<string, { bytes: Buffer | null; until: number }>();
  private cacheBytes = 0;
  constructor(readonly config: PlanningConfig, private readonly fetcher: typeof fetch = fetch) {}

  presentation(input: NamedAreaInput | undefined, baseReady: boolean): PlanningPresentation {
    const region = planningRegion(input);
    if (!region) return { availability: 'not_supported', region: null, source: null, notice: '' };
    const source = this.config.sources[region];
    if (!this.config.enabled || !source) return {
      availability: 'unconfigured', region, source: null,
      notice: 'Chưa cấu hình nguồn quy hoạch cho khu vực này.',
    };
    if (!baseReady) return { availability: 'unavailable', region, source: null,
      notice: 'Cần tải được bản đồ khu vực trước khi xem lớp quy hoạch.' };
    return { availability: 'ready', region,
      notice: 'Quy hoạch khu vực tham khảo; chưa xác định vị trí và ranh lô đất. Vùng không có màu chưa đủ để kết luận không có quy hoạch.',
      source: {
        label: source.label, sourceUrl: source.sourceUrl, legendUrl: source.legendUrl,
        revision: source.revision, tilePathTemplate: `/maps/planning/${region}/${source.revision}/{z}/{x}/{y}.png`,
        minZoom: source.minZoom, maxNativeZoom: source.maxNativeZoom,
        publishedAt: source.publishedAt, coverageBounds: source.coverageBounds,
      } };
  }

  private remember(key: string, bytes: Buffer | null, seconds: number) {
    if (seconds <= 0) return;
    const old = this.cache.get(key);
    if (old) this.cacheBytes -= old.bytes?.length ?? 0;
    this.cache.delete(key);
    this.cache.set(key, { bytes, until: Date.now() + seconds * 1000 });
    this.cacheBytes += bytes?.length ?? 0;
    while (this.cache.size > 256 || this.cacheBytes > 32 * 1024 * 1024) {
      const first = this.cache.keys().next().value!;
      this.cacheBytes -= this.cache.get(first)?.bytes?.length ?? 0;
      this.cache.delete(first);
    }
  }

  async tile(region: PlanningRegion, revision: string, z: number, x: number, y: number): Promise<Buffer> {
    const source = this.config.sources[region];
    if (!this.config.enabled || !source) throw unavailable();
    if (source.revision !== revision) throw noTile();
    if (!Number.isInteger(z) || z < source.minZoom || z > source.maxNativeZoom ||
      !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
      throw new DomainError(400, 'INVALID_INPUT', 'Ô quy hoạch không hợp lệ');
    }
    // Only request tiles intersecting Vietnam and, when supplied, the source extent.
    const [south, west, north, east] = source.coverageBounds ?? [8, 102, 24, 110];
    const lon = (tileX: number) => tileX / 2 ** z * 360 - 180;
    const lat = (tileY: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / 2 ** z))) * 180 / Math.PI;
    if (lon(x + 1) <= west || lon(x) >= east || lat(y) <= south || lat(y + 1) >= north) throw noTile();
    const key = `${region}/${revision}/${z}/${x}/${y}`;
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) {
      if (!cached.bytes) throw noTile();
      return cached.bytes;
    }
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    if (this.pending.size >= 32) throw new DomainError(429, 'RATE_LIMITED', 'Đang tải lớp quy hoạch, hãy thử lại.');
    const work = this.load(source, z, x, y).then(bytes => {
      this.remember(key, bytes, source.cacheSeconds);
      return bytes;
    }).catch((error: unknown) => {
      if (error instanceof DomainError && error.code === 'PLANNING_TILE_MISSING') this.remember(key, null, Math.min(30, source.cacheSeconds));
      throw error;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }

  private async load(source: PlanningSource, z: number, x: number, y: number): Promise<Buffer> {
    try {
      const url = source.tileUrlTemplate.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      // No forged Origin/Referer, session cookies, identity, or parcel ID sent upstream.
      const response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (response.status === 404 || response.status === 204) { await response.body?.cancel(); throw noTile(); }
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png') ||
        Number(response.headers.get('content-length') ?? 0) > MAX_BYTES || !response.body) {
        await response.body?.cancel(); throw unavailable();
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > MAX_BYTES) throw unavailable();
          chunks.push(value);
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== 256 || bytes.readUInt32BE(20) !== 256) throw unavailable();
      return bytes;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw unavailable();
    }
  }
}

export function planningTileRouter(maps: PlanningMapService): Router {
  const router = Router();
  router.get('/maps/planning/:region/:revision/:z/:x/:y.png', async (req, res) => {
    parse(z.object({}).strict(), req.query);
    const region = parse(regionSchema, req.params.region);
    const revision = parse(revisionSchema, req.params.revision);
    const level = parse(z.coerce.number().int().min(6).max(19), req.params.z);
    const coordinate = z.coerce.number().int().min(0).max(2 ** level - 1);
    const bytes = await maps.tile(region, revision, level, parse(coordinate, req.params.x), parse(coordinate, req.params.y));
    const seconds = maps.config.sources[region]!.cacheSeconds;
    res.setHeader('Cache-Control', seconds ? `public, max-age=${seconds}` : 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('image/png').send(bytes);
  });
  return router;
}
