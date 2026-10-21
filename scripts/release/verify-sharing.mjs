// Read-only acceptance against deployed public endpoints. Never logs credentials.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const origin = process.env.XLAND_SHARE_ORIGIN ?? 'https://xland-server-production.up.railway.app';
assert.equal(new URL(origin).origin, origin);
assert.equal(new URL(origin).protocol, 'https:');
const evidence = resolve(process.env.XLAND_SHARE_EVIDENCE ?? '.local/release/xland-share-20261021');
await mkdir(evidence, { recursive: true });
const get = (url, options = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000), ...options });
async function json(path) {
  const response = await get(origin + path);
  assert.equal(response.status, 200, path);
  return response.json();
}
const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const userAgents = {
  browser: 'Mozilla/5.0',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  whatsapp: 'WhatsApp/2.24.1',
  zalo: 'Zalo/1.0',
  twitter: 'Twitterbot/1.0',
};
const report = { time: new Date().toISOString(), origin, readiness: await json('/health/ready'), content: [] };
report.assetlinks = await json('/.well-known/assetlinks.json');
assert.equal(report.assetlinks[0]?.target.package_name, 'vn.xland.xland_mobile');
assert.ok(report.assetlinks[0].target.sha256_cert_fingerprints.length >= 2);
await writeFile(join(evidence, 'assetlinks.json'), JSON.stringify(report.assetlinks, null, 2));
const video = (await json('/api/v1/feed?limit=1')).data[0];
const property = (await json('/api/v1/properties?limit=1')).data[0];
assert.ok(video?.id && property?.id, 'Public content required');
for (const [kind, record] of [['videos', video], ['properties', property]]) {
  const linkedProperty = kind === 'videos' ? (await json(`/api/v1/properties/${record.propertyId}`)).data : record;
  const share = (await json(`/api/v1/${kind}/${record.id}/share`)).data;
  assert.equal(share.url, `${origin}/${kind}/${record.id}`);
  assert.equal(share.title, linkedProperty.title);
  const checks = [];
  let firstHtml, metadata;
  for (const [crawler, agent] of Object.entries(userAgents)) {
    const response = await get(share.url, { headers: { 'User-Agent': agent } });
    assert.equal(response.status, 200, crawler);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    if (firstHtml) assert.equal(html, firstHtml, 'Bots and browser must see the same HTML');
    else firstHtml = html;
    metadata = Object.fromEntries([...html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)">/g)].map(m => [m[1], decode(m[2])]));
    assert.equal(metadata['og:url'], share.url);
    assert.equal(metadata['og:title'], share.title);
    assert.ok(metadata['og:description']);
    assert.ok(metadata['og:image'].startsWith('https://'));
    assert.equal(metadata['twitter:image'], metadata['og:image']);
    assert.ok(html.includes(`xland://share/${kind}/${record.id}`));
    assert.ok(!html.includes('<script'));
    checks.push({ crawler, status: response.status, contentType: response.headers.get('content-type'), cacheControl: response.headers.get('cache-control') });
  }
  await writeFile(join(evidence, `${kind}.html`), firstHtml);
  const head = await get(share.url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  const imageResponse = await get(metadata['og:image'], { headers: { 'User-Agent': userAgents.facebook } });
  assert.equal(imageResponse.status, 200, 'Public preview image');
  assert.match(imageResponse.headers.get('content-type'), /image\/(png|jpeg|webp)/);
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  let dimensions = null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    assert.ok(dimensions.width >= 200 && dimensions.height >= 200);
  }
  report.content.push({ kind, id: record.id, url: share.url, metadata, checks, headStatus: head.status,
    image: { status: imageResponse.status, contentType: imageResponse.headers.get('content-type'), bytes: bytes.length, dimensions } });
}
const missing = await get(`${origin}/videos/00000000-0000-4000-8000-000000000000`);
assert.equal(missing.status, 404);
report.missingStatus = missing.status;
report.scope = 'Read-only HTTP acceptance with crawler User-Agent simulation; actual cards inside chat apps are controlled and cached by those apps.';
await writeFile(join(evidence, 'public-sharing-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
