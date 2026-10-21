import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import type { CoreService } from '../services/core.js';
import { DomainError } from '../domain/errors.js';
import { uuid } from '../schemas/http.js';
import type { SharingConfig } from './config.js';
import { readShareContent, shareUrl, type ShareContent } from './content.js';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]!);

export function shareHtml(content: ShareContent, url: string, appUrl: string, image: string): string {
  const title = escapeHtml(content.title);
  const description = escapeHtml(content.description + (content.illustrative ? ' • Dữ liệu minh họa' : ''));
  const canonical = escapeHtml(url);
  const poster = escapeHtml(image);
  return `<!doctype html>
<html lang="vi" prefix="og: https://ogp.me/ns#"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | XLand</title><meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website"><meta property="og:site_name" content="XLand">
<meta property="og:locale" content="vi_VN"><meta property="og:url" content="${canonical}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${description}">
<meta property="og:image" content="${poster}"><meta property="og:image:secure_url" content="${poster}">
<meta property="og:image:alt" content="${title}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${poster}">
<style>body{margin:0;background:#f3f6f5;color:#153b32;font:16px/1.6 system-ui,sans-serif}main{max-width:680px;margin:40px auto;background:white;border-radius:24px;overflow:hidden;box-shadow:0 10px 40px #163c3210}header,section{padding:24px 32px}header{font-size:26px;font-weight:750;letter-spacing:1px}img{display:block;width:100%;max-height:360px;object-fit:contain;background:#edf3f0}h1{font-size:28px;line-height:1.3;margin-top:0}p{overflow-wrap:anywhere}.button{display:inline-block;background:#17664d;color:white;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:650}.hint{font-size:14px;color:#52645f}.badge{display:inline-block;background:#fff1cf;padding:4px 12px;border-radius:20px;font-size:13px}@media(max-width:720px){main{margin:16px;border-radius:18px}header,section{padding:20px}h1{font-size:24px}}</style>
</head><body><main><header>XLAND</header><img src="${poster}" alt="${title}">
<section>${content.illustrative ? '<p class="badge">Dữ liệu minh họa</p>' : ''}<h1>${title}</h1><p>${description}</p>
<a class="button" href="${escapeHtml(appUrl)}">Mở trong ứng dụng XLand</a>
<p class="hint">Nếu đã cài XLand, hãy mở ứng dụng để xem đầy đủ nội dung. Nếu ứng dụng chat không mở được, hãy mở liên kết bằng trình duyệt của thiết bị.</p>
<p class="hint">Chưa cài XLand? Bạn vẫn có thể xem thông tin tóm tắt trên trang này. Bản cài hiện được cung cấp trong chương trình thử nghiệm của XLand.</p>
</section></main></body></html>`;
}

export function sharingRouter(core: CoreService, config: SharingConfig): Router {
  const router = Router();
  router.get('/.well-known/assetlinks.json', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300').json(config.androidFingerprints.length ? [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: config.androidPackage, sha256_cert_fingerprints: config.androidFingerprints },
    }] : []);
  });
  router.get('/.well-known/apple-app-site-association', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300').json({ applinks: {
      apps: [], details: config.appleAppId ? [{ appID: config.appleAppId, paths: ['/properties/*', '/videos/*', '/events/*'] }] : [],
    } });
  });
  router.get('/share/default-preview.png', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(fileURLToPath(new URL('../../public/share-default.png', import.meta.url)));
  });
  for (const kind of ['properties', 'videos', 'events'] as const) {
    router.get(`/${kind}/:id`, async (req, res) => {
      res.set({
        'Content-Security-Policy': "default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      const id = uuid.safeParse(req.params.id);
      if (!id.success) { res.status(404).type('html').send(unavailableHtml()); return; }
      if (!config.publicBaseUrl) { res.status(503).type('html').send(unavailableHtml()); return; }
      try {
        // Do not read auth headers/cookies; the HTML is identical for crawlers and people.
        const content = await core.read(null, c => readShareContent(c, kind, id.data));
        const url = shareUrl(config.publicBaseUrl, kind, id.data);
        const appUrl = `xland://share/${kind}/${id.data.toLowerCase()}`;
        const image = content.image ?? `${config.publicBaseUrl}/share/default-preview.png`;
        res.type('html').send(shareHtml(content, url, appUrl, image));
      } catch (error) {
        if (error instanceof DomainError && error.status === 404) {
          res.status(404).type('html').send(unavailableHtml()); return;
        }
        throw error;
      }
    });
  }
  return router;
}

function unavailableHtml(): string {
  return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Nội dung không khả dụng | XLand</title></head><body><h1>Nội dung không khả dụng</h1><p>Liên kết không hợp lệ, nội dung đã được gỡ hoặc tính năng chia sẻ chưa sẵn sàng.</p></body></html>';
}
