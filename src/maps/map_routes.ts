import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { CoreService } from '../services/core.js';
import type { Identity } from '../services/auth.js';
import { parse, uuid } from '../schemas/http.js';
import { missing } from '../domain/errors.js';
import type { AreaMapService, AreaMapProvider } from './area_map_service.js';

/** Mount inside apiRouter after its normal identify + strict request middleware. */
export function areaMapApiRouter(core: Pick<CoreService, 'read'>, maps: AreaMapProvider): Router {
  const router = Router();
  router.get('/properties/:propertyId/area-map', async (req, res) => {
    parse(z.object({}).strict(), req.query);
    const propertyId = parse(uuid, req.params.propertyId);
    const identity = res.locals.identity as Identity | null;
    // Normal read identity + RLS even when maps are disabled. Never reveal catalog bindings for a hidden/missing property.
    const input = await core.read(identity, async client => {
      const row = await client.query('SELECT id, commune_name AS commune, province FROM xland.properties WHERE id=$1', [propertyId]);
      if (!row.rowCount) missing();
      return row.rows?.[0];
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: await maps.presentation(propertyId, input) });
  });
  return router;
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Separate public wrapper: no session/header injection, no arbitrary HTML/URL or property ID input. */
export function areaMapPageRouter(maps: AreaMapService): Router {
  const router = Router();
  router.get('/maps/embed/:areaId', (req, res) => {
    const query = parse(z.object({ category: z.enum(['all', 'school', 'hospital', 'park']).default('all') }).strict(), req.query);
    const areaId = parse(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), req.params.areaId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!maps.config.enabled) { res.status(503).type('text').send('Bản đồ Google chưa được cấu hình'); return; }
    if (req.get('host')?.toLowerCase() !== new URL(maps.config.wrapperOrigin).host.toLowerCase()) {
      res.status(421).type('text').send('Địa chỉ bản đồ chưa được cấu hình'); return;
    }
    const area = maps.catalog.get(areaId);
    if (!area || maps.catalog.invalid) { res.status(404).type('text').send('Chưa có khu vực được kiểm tra'); return; }
    const nonce = randomBytes(18).toString('base64');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'none'; style-src 'nonce-${nonce}'; frame-src https://www.google.com/maps/; frame-ancestors 'self' ${maps.config.parentOrigins.join(' ')}; base-uri 'none'; form-action 'none'`);
    // iframe load is not proof of Google success; clients must not claim the cross-origin map has been verified.
    res.type('html').send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bản đồ khu vực</title><style nonce="${nonce}">html,body{margin:0;width:100%;height:100%;min-width:200px;min-height:200px}iframe{display:block;border:0;width:100%;height:100%;min-height:200px}</style></head><body><iframe title="${escapeHtml('Bản đồ khu vực ' + area.label)}" src="${escapeHtml(maps.googleUrl(area, query.category).toString())}" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></body></html>`);
  });
  return router;
}
