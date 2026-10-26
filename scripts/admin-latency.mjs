import {once} from 'node:events';
import {writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import {Router} from 'express';
import {createApp} from '../src/app.ts';
import {Database} from '../src/repositories/database.ts';
import {AuthService} from '../src/services/auth.ts';
import {adminRouter} from '../src/admin/router.ts';
import {AdminAuth} from '../src/admin/auth.ts';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

let queryCount = 0;
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (...args) {
  queryCount++;
  return originalQuery.apply(this, args);
};

const db = new Database(connectionString, 4);
const auth = new AuthService(db);
await auth.initialize();

const adminAuth = new AdminAuth(db, auth);
await adminAuth.initialize();

console.log('Logging in as admin to obtain test token...');
const loginRes = await adminAuth.login(
  process.env.XLAND_ADMIN_USERNAME ?? 'admin',
  process.env.XLAND_ADMIN_PASSWORD ?? '123456',
  '127.0.0.1'
);
const token = loginRes.accessToken;
console.log('Admin session acquired.');

// Find a sample property ID
const propRow = (await db.pool.query('SELECT id FROM xland.properties LIMIT 1')).rows[0];
const samplePropertyId = propRow?.id ?? '00000000-0000-4000-8000-000000000005';

// Setup local express server
const router = Router().use('/admin', await adminRouter(db, auth, process.env));
const server = createApp({ checkReadiness: () => db.ready(), api: router }).listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/api/v1/admin`;

console.log(`Server listening on ${base}`);

// Measure pure RTT using SELECT 1
console.log('Measuring pure RTT with SELECT 1...');
const rttTimes = [];
for (let i = 0; i < 5; i++) {
  const start = performance.now();
  await db.pool.query('SELECT 1');
  rttTimes.push(performance.now() - start);
}
const medianRtt = rttTimes.sort((a, b) => a - b)[Math.floor(rttTimes.length / 2)];
console.log(`Measured DB RTT: ~${medianRtt.toFixed(1)} ms`);

const endpoints = [
  { name: 'GET /session', path: '/session', method: 'GET' },
  { name: 'GET /schema', path: '/schema', method: 'GET' },
  { name: 'GET /properties', path: '/properties', method: 'GET' },
  { name: `GET /properties/:id`, path: `/properties/${samplePropertyId}`, method: 'GET' },
  { name: 'GET /locations', path: '/locations', method: 'GET' },
];

const ITERATIONS = 10;
const results = {};

for (const ep of endpoints) {
  results[ep.name] = { latencies: [], queries: [] };
  console.log(`\nBenchmarking ${ep.name} (${ITERATIONS} iterations)...`);

  for (let i = 0; i < ITERATIONS; i++) {
    queryCount = 0;
    const start = performance.now();
    const res = await fetch(base + ep.path, {
      method: ep.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    const duration = performance.now() - start;
    if (!res.ok) {
      const err = await res.text();
      console.error(`Request failed: ${res.status} - ${err}`);
      continue;
    }
    await res.json();
    results[ep.name].latencies.push(duration);
    results[ep.name].queries.push(queryCount);
    process.stdout.write(`  [${i + 1}/${ITERATIONS}] ${duration.toFixed(0)} ms (${queryCount} queries)\n`);
  }
}

server.close();
await db.close();

function stats(arr) {
  if (!arr.length) return { min: 0, max: 0, mean: 0, median: 0, p95: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? max;
  return { min, max, mean, median, p95 };
}

let report = `# BASELINE PERFORMANCE REPORT (Giai đoạn 0)
**Thời gian đo:** ${new Date().toISOString()}  
**Môi trường:** Localhost Backend \`xland-server\` ⇄ Supabase Mumbai (\`ap-south-1\`)  
**Số mẫu lặp:** ${ITERATIONS} lượt / endpoint  
**Độ trễ vật lý (Median RTT SELECT 1):** ${medianRtt.toFixed(1)} ms  

## Kết quả đo đạc chi tiết

| Endpoint | Median Latency | P95 Latency | Min - Max Latency | Queries/Req | Đánh giá RTT tương đương |
| :--- | :---: | :---: | :---: | :---: | :---: |
`;

for (const ep of endpoints) {
  const l = stats(results[ep.name].latencies);
  const q = stats(results[ep.name].queries);
  const rttEquiv = Math.round(l.median / medianRtt);
  report += `| \`${ep.name}\` | **${l.median.toFixed(0)} ms** | ${l.p95.toFixed(0)} ms | ${l.min.toFixed(0)} - ${l.max.toFixed(0)} ms | **${q.median} SQL** | ~${rttEquiv} RTT |\n`;
}

report += `
## Phân tích Baseline

1. **\`GET /session\` (~${stats(results['GET /session'].latencies).median.toFixed(0)} ms, ${stats(results['GET /session'].queries).median} SQL):**
   - Xác thực phiên mở transaction \`xland_auth\`, kiểm tra token digest, lấy thông tin profile người dùng.
   - Khi có In-Memory cache (B5), chi phí này sẽ giảm về **~0 ms**.

2. **\`GET /schema\` (~${stats(results['GET /schema'].latencies).median.toFixed(0)} ms, ${stats(results['GET /schema'].queries).median} SQL):**
   - Truy vấn \`information_schema.columns\` qua mạng tới Mumbai mỗi lần gọi.
   - Khi có In-Memory column cache (B1), endpoint này sẽ phản hồi tức thì **< 10 ms**.

3. **\`GET /properties\` (~${stats(results['GET /properties'].latencies).median.toFixed(0)} ms, ${stats(results['GET /properties'].queries).median} SQL):**
   - Đọc \`fields()\` (query information_schema) + \`SELECT count(*)\` + \`SELECT items\` + duyệt foreign key labels.
   - Sau B1 + B2 + B3 + B4, số query sẽ giảm từ **${stats(results['GET /properties'].queries).median} SQL** xuống còn **1-2 SQL**.

4. **\`GET /properties/:id\` (~${stats(results['GET /properties/:id'].latencies).median.toFixed(0)} ms, ${stats(results['GET /properties/:id'].queries).median} SQL):**
   - Tương tự, tốn RTT cho đọc fields + row chi tiết.

---
> Mục tiêu Giai đoạn 1: Đưa median latency của \`GET /schema\` và \`GET /session\` xuống < 10ms (cache), và các danh sách/chi tiết xuống < 400-600ms.
`;

console.log('\n' + report);

// Save to docs/qa/admin-perf/BASELINE.md
const outPath = resolve('docs/qa/admin-perf/BASELINE.md');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, report, 'utf8');
console.log(`Baseline report saved to ${outPath}`);
