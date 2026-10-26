import type { EmbedConfig } from './embed_config.js';
import type { PublicAreaRecord } from './area_catalog.js';
import type { PublicAreaCatalog } from './area_catalog.js';
import type { PlanningPresentation } from './planning_maps.js';

export const amenityTerms = { all: null, school: 'trường học', hospital: 'bệnh viện', park: 'công viên' } as const;
export type MapCategory = keyof typeof amenityTerms;
export const mapNotice = 'Bản đồ khu vực tham khảo; không thể hiện vị trí lô đất.';
export interface AreaMapPresentation {
  propertyId: string;
  availability: 'ready' | 'unconfigured' | 'invalid_area' | 'unavailable';
  publicArea: null | Pick<PublicAreaRecord, 'id' | 'label' | 'centerLatitude' | 'centerLongitude' | 'radiusM' | 'initialZoom' | 'precision' | 'sourceUpdatedAt' | 'checkedAt'>;
  provider: 'none' | 'google_embed' | 'geoapify';
  poiMode: 'none' | 'embedded_search';
  attribution: { label: string; url: string }[];
  notice: string;
  externalAreaMapUrl: string | null;
  /** Public HTTPS wrapper URL, never contains key, property ID or customer identity. */
  embedPageUrl: string | null;
  areaLabel?: string | null;
  tilePathTemplate?: string | null;
  externalDirectionsUrl?: string | null;
  planning?: PlanningPresentation;
}

export interface NamedAreaInput {
  commune: string | null; province: string;
  provinceCode?: string; catalogVersion?: string; catalogProvince?: string | null;
}
export interface AreaMapProvider {
  presentation(propertyId: string, input?: NamedAreaInput): AreaMapPresentation | Promise<AreaMapPresentation>;
}

export class AreaMapService {
  constructor(readonly config: EmbedConfig, readonly catalog: PublicAreaCatalog) {}
  presentation(propertyId: string): AreaMapPresentation {
    const area = this.catalog.forProperty(propertyId);
    const ready = this.config.enabled && !!area && !this.catalog.invalid;
    const external = area ? new URL('https://www.google.com/maps/search/') : null;
    if (external && area) { external.searchParams.set('api', '1'); external.searchParams.set('query', area.label); }
    return {
      propertyId,
      availability: this.catalog.invalid ? 'invalid_area' : !this.config.enabled ? 'unconfigured' : !area ? 'unavailable' : 'ready',
      publicArea: area ? {
        id: area.id, label: area.label, centerLatitude: area.centerLatitude, centerLongitude: area.centerLongitude,
        radiusM: area.radiusM, initialZoom: area.initialZoom, precision: area.precision,
        sourceUpdatedAt: area.sourceUpdatedAt, checkedAt: area.checkedAt,
      } : null,
      provider: ready ? 'google_embed' : 'none',
      poiMode: ready ? 'embedded_search' : 'none',
      attribution: ready ? [{ label: 'Google Maps', url: 'https://www.google.com/maps' }] : [],
      notice: this.catalog.invalid ? 'Dữ liệu khu vực chưa được cấu hình hợp lệ. ' + mapNotice :
        !this.config.enabled ? this.config.reason + '. ' + mapNotice :
        !area ? 'Chưa có tâm địa bàn đã kiểm tra cho lô này. ' + mapNotice : mapNotice,
      externalAreaMapUrl: external?.toString() ?? null,
      embedPageUrl: ready && area ? new URL(`/maps/embed/${area.id}`, this.config.wrapperOrigin).toString() : null,
    };
  }
  googleUrl(area: PublicAreaRecord, category: MapCategory): URL {
    const term = amenityTerms[category];
    const url = new URL(`https://www.google.com/maps/embed/v1/${term ? 'search' : 'view'}`);
    url.searchParams.set('key', this.config.apiKey);
    url.searchParams.set('center', `${area.centerLatitude},${area.centerLongitude}`);
    url.searchParams.set('zoom', String(area.initialZoom));
    url.searchParams.set('maptype', 'roadmap');
    url.searchParams.set('language', 'vi');
    url.searchParams.set('region', 'VN');
    if (term) url.searchParams.set('q', `${term} tại ${area.label}`);
    return url;
  }
}
