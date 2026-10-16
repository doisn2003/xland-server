import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = JSON.parse(readFileSync(join(root, 'brain/logs/agent-c/fixtures/v0.1.json'), 'utf8').replace(/^\uFEFF/, ''));
const examples = JSON.parse(readFileSync(join(root, 'brain/logs/agent-c/fixtures/operations.v0.1.json'), 'utf8').replace(/^\uFEFF/, ''));
const schema = JSON.parse(readFileSync(join(root, 'brain/logs/agent-c/fixtures/schema.C3.json'), 'utf8'));
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
const activeOperations = operations.filter(([, value]) => value.lifecycle === 'active_contract');
const reservedOperations = operations.filter(([, value]) => value.lifecycle === 'reserved');
assert.equal(examples.operationSummary.activeContractCount, activeOperations.length);
assert.deepEqual(reservedOperations.map(([key]) => key), examples.operationSummary.reservedOperationIds);
assert.equal(examples.U02.lifecycle, 'reserved');
assert.equal(examples.U02.implemented, false);
assert.ok(!('request' in examples.U02) && !('response' in examples.U02));
assert.equal(examples.operationSummary.businessApisImplemented, 0);
const routes = new Set();
const contract = readFileSync(join(root, 'brain/02_API_CONTRACT.md'), 'utf8');
const contractOperations = [...contract.matchAll(/^\| ([A-Z]\d{2}) \| (GET|POST|PUT|DELETE|PATCH) ([^|]+?) \|/gm)];
assert.deepEqual(activeOperations.map(([key]) => key).sort(), contractOperations.map(match => match[1]).sort());
for (const [key, example] of activeOperations) {
  const declaration = contractOperations.find(match => match[1] === key);
  assert.equal(example.request.method, declaration[2]);
  const pathPattern = declaration[3].replace(/\{\w+\}/g, '[0-9a-f-]{36}');
  assert.match(example.request.path, new RegExp(`^/api/v1${pathPattern}$`));
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
assert.equal(fixture.contractRevision, 'C-3');
assert.equal(examples.contractRevision, 'C-3');
assert.equal(examples.F01.request.query.feedScope, 'recommended');
assert.equal(examples.variants.F01Following.request.query.feedScope, 'following');
assert.equal(examples.variants.F01FollowingGuest.response.status, 401);
assert.equal(fixture.sampleTypes.SupportRequest.status, 'received');
assert.equal(fixture.authDesign.identity, 'internal_postgresql');
assert.equal(fixture.authDesign.absoluteLifetimeHours, 24);
assert.equal(fixture.authDesign.refreshEnabled, false);
assert.ok(!('SignInInput' in fixture.sampleTypes), 'Do not place provisioned credentials in fixture samples');
assert.equal(examples.U01.request.credentialTemplate, true);
assert.ok('username' in examples.U01.request.body && !('email' in examples.U01.request.body));
assert.ok(!JSON.stringify(examples).includes('refreshToken'));
assert.deepEqual(Object.keys(examples.U01.response.body.data).sort(), ['accessToken', 'session']);
const sessionLifetime = Date.parse(examples.U01.response.body.data.session.expiresAt) - Date.parse(fixture.clock);
assert.equal(sessionLifetime, 24 * 60 * 60 * 1000);
for (const filterCase of fixture.filterCases) {
  const f = filterCase.filter;
  const selectedCount = [f.query, f.regions.length, f.category, f.provinceCode, f.districtCode,
    f.minPriceVnd !== null || f.maxPriceVnd !== null, f.areaBands.length, f.landTypes.length,
    f.minRoadWidthM, f.hasDocuments !== null].filter(Boolean).length;
  assert.equal(selectedCount, filterCase.selectedCriteriaCount);
  assert.equal(filterCase.total, 1);
}
const schemaDocument = readFileSync(join(root, 'brain/logs/agent-c/P1_DATABASE_DESIGN.md'), 'utf8');
const declaredTables = [...schemaDocument.matchAll(/^### ([a-z_]+)$/gm)].map(match => match[1]);
const declaredDetails = [...schemaDocument.matchAll(/^### ([a-z_]+)\n([\s\S]*?)(?=^### |^## |$)/gm)];
assert.equal(schema.tableCount, schema.tables.length);
assert.deepEqual(schema.tables.map(table => table.name), declaredTables);
assert.deepEqual(schema.tables.map(table => table.details), declaredDetails.map(match => match[2].trim()));
assert.equal(new Set(declaredTables).size, declaredTables.length);
for (const name of ['consultants', 'properties', 'property_legal_items', 'property_documents',
  'property_nearby_amenities', 'events', 'site_visit_bookings']) assert.ok(declaredTables.includes(name));
for (const name of ['user_identities', 'auth_sessions']) {
  assert.equal(schema.tables.find(table => table.name === name).visibility, 'private_auth');
}
assert.ok(!schemaDocument.includes('FK auth.users'));

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
const domainSource = readFileSync(join(root, 'xland-mobile/lib/domain/entities/account.dart'), 'utf8');
assert.match(domainSource, /SignInInput\(\{required this.username, required this.password\}\)/);
assert.ok(!/final String email;/.test(domainSource));
const feedInterface = readFileSync(join(root, 'xland-mobile/lib/domain/repositories/xland_repositories.dart'), 'utf8');
assert.ok(feedInterface.includes('FeedScope feedScope = FeedScope.recommended'));
const sessionStore = readFileSync(join(root, 'xland-mobile/lib/data/datasources/local/session_store.dart'), 'utf8');
assert.ok(!sessionStore.includes('refreshToken') && sessionStore.includes('saveAccessToken'));
console.log(`PASS C-3: canonical properties/videos/legal; ${activeOperations.length} active contract examples; ${reservedOperations.length} reserved (U02); ${schema.tableCount} design tables; auth/feed/filter/settings/support alignment; C boundaries. No DB/auth/API execution.`);
