import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const areaId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const httpsSource = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
});
export const publicAreaSchema = z.object({
  id: areaId,
  label: z.string().trim().min(3).max(200),
  provinceLabel: z.string().trim().min(2).max(100),
  centerLatitude: z.number().finite().min(-85).max(85),
  centerLongitude: z.number().finite().min(-180).max(180),
  radiusM: z.number().int().positive().max(100000),
  initialZoom: z.number().int().min(3).max(16),
  precision: z.literal('administrative_area'),
  sourceUrl: httpsSource,
  checkedAt: z.iso.datetime({ offset: true }),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  publicUseApproved: z.literal(true),
}).strict();
export type PublicAreaRecord = z.infer<typeof publicAreaSchema>;
const catalogSchema = z.object({
  version: z.literal(1),
  areas: z.array(publicAreaSchema).max(2000),
  properties: z.array(z.object({ propertyId: z.uuid(), areaId }).strict()).max(10000),
}).strict();

/** Operator-reviewed public administrative centres only. Never reads property coordinates. */
export class PublicAreaCatalog {
  private readonly areas = new Map<string, PublicAreaRecord>();
  private readonly properties = new Map<string, string>();
  constructor(input: unknown = { version: 1, areas: [], properties: [] }, readonly invalid = false) {
    if (invalid) return;
    const parsed = catalogSchema.parse(input);
    for (const area of parsed.areas) {
      if (this.areas.has(area.id)) throw new Error('Duplicate public area ID');
      this.areas.set(area.id, Object.freeze(area));
    }
    for (const link of parsed.properties) {
      if (this.properties.has(link.propertyId) || !this.areas.has(link.areaId)) {
        throw new Error('Invalid public area binding');
      }
      this.properties.set(link.propertyId, link.areaId);
    }
  }
  forProperty(id: string): PublicAreaRecord | undefined {
    const key = this.properties.get(id);
    return key ? this.areas.get(key) : undefined;
  }
  get(id: string): PublicAreaRecord | undefined { return this.areas.get(id); }
}

export async function loadPublicAreaCatalog(path?: string): Promise<PublicAreaCatalog> {
  if (!path) return new PublicAreaCatalog();
  try {
    const bytes = await readFile(path);
    if (bytes.length > 1024 * 1024) throw new Error('Catalog size limit');
    return new PublicAreaCatalog(JSON.parse(bytes.toString('utf8')) as unknown);
  } catch {
    // Do not log file contents, paths, source payloads or credentials.
    return new PublicAreaCatalog(undefined, true);
  }
}
