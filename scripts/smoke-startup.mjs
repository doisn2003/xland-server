import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const probe = createServer().listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
probe.close();
await once(probe, 'close');
const child = spawn(process.execPath, ['dist/server.js'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, NODE_ENV: 'test', PORT: String(port), XLAND_API_MODE:'bootstrap' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let output = '';
const started = new Promise((resolve, reject) => {
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    if (output.includes('server_started')) resolve();
  });
  child.once('error', reject);
  child.once('exit', () => reject(new Error('Server exited before startup')));
});
try {
  await Promise.race([started, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000);
    timer.unref();
  })]);
  const live = await fetch(`http://127.0.0.1:${port}/health/live`);
  const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
  assert.equal(live.status, 200);
  assert.equal(ready.status, 503);
  console.log('PASS compiled startup: liveness 200; readiness 503; no DB connection attempted.');
} finally {
  if (child.exitCode === null) {
    const closed = once(child, 'exit');
    child.kill('SIGTERM');
    await closed;
  }
}
