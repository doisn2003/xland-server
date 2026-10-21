import type { PoolClient } from 'pg';
import { missing } from '../domain/errors.js';
import { publicOrigin } from './config.js';

export type ShareKind = 'properties' | 'videos' | 'events';
export interface ShareContent {
  title: string;
  description: string;
  image: string | null;
  illustrative: boolean;
}

export function shareUrl(base: string, kind: ShareKind, id: string): string {
  return `${publicOrigin(base)}/${kind}/${id.toLowerCase()}`;
}

// Only publish permanent public media. Never expose provider-signed query URLs,
// credentials, local development media or private document/download endpoints.
export function publicImage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.test') ||
        /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[') ||
        /\/(?:sign|authenticated|private|download)(?:\/|$)/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

/** Caller MUST use the anonymous xland_api transaction, even for logged-in sharers. */
export async function readShareContent(c: PoolClient, kind: ShareKind, id: string): Promise<ShareContent> {
  if (kind === 'events') {
    const row = (await c.query('SELECT title,venue_name,media,is_illustrative FROM xland.events WHERE id=$1', [id])).rows[0];
    if (!row) missing();
    const media = Array.isArray(row.media) ? row.media as Record<string, unknown>[] : [];
    return { title: String(row.title), description: `Sự kiện XLand • ${row.venue_name}`,
      image: media.map(m => publicImage(m.thumbnailUrl) ?? (m.kind === 'image' ? publicImage(m.url) : null)).find(Boolean) ?? null,
      illustrative: row.is_illustrative === true };
  }
  const row = (await c.query(kind === 'properties'
    ? `SELECT p.title,p.district,p.province,p.area_m2::text,p.price_total::text,p.is_illustrative,
        (SELECT jsonb_agg(COALESCE(CASE WHEN m.kind='image' THEN m.public_url END,m.thumbnail_url) ORDER BY m.sort_order,m.id)
         FROM xland.property_media m WHERE m.property_id=p.id AND m.usage='gallery'
         ) images
       FROM xland.properties p WHERE p.id=$1 AND p.approval_status='approved' AND p.status IN ('listed','sold')`
    : `SELECT p.title,p.district,p.province,p.area_m2::text,p.price_total::text,
        (v.is_illustrative OR p.is_illustrative) is_illustrative,v.caption,jsonb_build_array(m.thumbnail_url) images
       FROM xland.videos v JOIN xland.properties p ON p.id=v.property_id
       JOIN xland.property_media m ON m.id=v.media_id AND m.property_id=p.id
       WHERE v.id=$1 AND v.approval_status='approved' AND v.deleted_at IS NULL
         AND p.approval_status='approved' AND p.status IN ('listed','sold')`, [id])).rows[0];
  if (!row) missing();
  const price = new Intl.NumberFormat('vi-VN').format(BigInt(String(row.price_total)));
  const area = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 }).format(Number(row.area_m2));
  const facts = `${area} m² • ${price} ₫ • ${row.district}, ${row.province}`;
  return {
    title: String(row.title),
    description: (kind === 'videos' && row.caption ? `${String(row.caption).slice(0, 180)} • ` : '') + facts,
    image: (Array.isArray(row.images) ? row.images as unknown[] : []).map(publicImage).find(Boolean) ?? null,
    illustrative: row.is_illustrative === true,
  };
}
