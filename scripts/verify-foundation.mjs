import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = JSON.parse(readFileSync(join(root, 'brain/logs/agent-c/fixtures/v0.1.json'), 'utf8').replace(/^\uFEFF/, ''));
const examples = JSON.parse(readFileSync(join(root, 'brain/logs/agent-c/fixtures/operations.v0.1.json'), 'utf8').replace(/^\uFEFF/, ''));
const properties = new Map(fixture.properties.map(p => [p.id, p]));
assert.equal(properties.size, 4);
assert.deepEqual(fixture.properties.map(p => [p.priceTotal, p.areaM2]), [
  ['2400000000', '120'], ['1800000000', '100'], ['3000000000', '150'], ['2700000000', '100'],
]);
for (const p of properties.values()) assert.equal(BigInt(p.priceTotal) / BigInt(p.areaM2), BigInt(p.pricePerM2));
assert.equal(fixture.legalItems.filter(i => i.status === 'verified').length, 4);
assert.equal(fixture.legalItems.filter(i => i.status === 'pending').length, 2);
assert.deepEqual(fixture.documents.map(d => d.sizeBytes), [2300000, 4100000]);
assert.equal(fixture.feedVideos.length, 24);
assert.equal(new Set(fixture.feedVideos.map(v => v.id)).size, 24);
for (const video of fixture.feedVideos) {
  assert.ok(properties.has(video.propertyId));
  assert.deepEqual(video.property, properties.get(video.propertyId));
  assert.equal(video.author.id, fixture.consultants[0].id);
}
assert.equal(fixture.feedVideos[0].propertyId, fixture.feedVideos[1].propertyId);
assert.notEqual(fixture.feedVideos[0].id, fixture.feedVideos[1].id);
assert.equal(fixture.feedVideos[0].media.id, fixture.properties[0].media[0].id);
assert.ok(new Date(fixture.events[0].endsAt) < new Date(fixture.clock));
assert.ok(new Date(fixture.futureEvents[0].startsAt) > new Date(fixture.clock));
assert.ok(new Date(fixture.slots[0].startsAt) > new Date(fixture.clock));
for (const scenario of fixture.paymentScenarios) {
  assert.equal(scenario.payment.mode, 'simulation');
  assert.equal(scenario.payment.bookingId, scenario.booking.id);
  assert.equal(scenario.payment.status, scenario.booking.paymentStatus);
  if (['confirmed', 'completed'].includes(scenario.booking.status)) {
    assert.equal(scenario.payment.status, 'succeeded');
    assert.ok(scenario.booking.confirmedStartsAt);
  }
  if (scenario.booking.status === 'completed') {
    assert.ok(new Date(scenario.booking.confirmedStartsAt) < new Date(fixture.clock));
  }
}
const operations = Object.entries(examples).filter(([key]) => /^[A-Z]\d{2}$/.test(key));
assert.equal(operations.length, 64);
const routes = new Set();
const contract = readFileSync(join(root, 'brain/02_API_CONTRACT.md'), 'utf8');
for (const [key, example] of operations) {
  assert.ok(contract.includes(`| ${key} |`));
  assert.ok(!example.request.path.includes('undefined'));
  const signature = `${example.request.method} ${example.request.path}`;
  assert.ok(!routes.has(signature));
  routes.add(signature);
  assert.ok('body' in example.response);
}
for (const key of ['P03', 'B06', 'B07', 'N01', 'N02']) assert.equal(examples[key].response.status, 409);
assert.equal(fixture.sampleTypes.DepositPolicy.chargeBasis, null);
assert.equal(fixture.sampleTypes.DepositPolicy.livePaymentEnabled, false);
assert.equal(fixture.sampleTypes.SavedFinancePlan.result, null);

function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(path, entry.name)) : entry.name.endsWith('.dart') ? [join(path, entry.name)] : []);
}
for (const path of files(join(root, 'xland-mobile/lib/domain'))) {
  const source = readFileSync(path, 'utf8');
  const imports = [...source.matchAll(/import\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(imports.every(i => !i.startsWith('package:') && !/(^|\/)(data|presentation|bootstrap)\//.test(i)), `Domain import violation: ${path}`);
}
for (const path of files(join(root, 'xland-mobile/lib/data'))) {
  const source = readFileSync(path, 'utf8');
  assert.ok(!/import\s+['"][^'"]*presentation\//.test(source), `Data import violation: ${path}`);
}
console.log('PASS: 4 canonical properties; 24 videos; legal/documents; historical/future split; simulation states; 64 examples; C import boundaries. No DB/API execution.');
