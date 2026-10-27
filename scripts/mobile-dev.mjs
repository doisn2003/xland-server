// Local API for Android Studio. Uses the existing demo DB; startup never seeds or migrates.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parse} from 'dotenv';
import {runtime} from '../src/runtime.ts';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
let configured, server, stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  try {
    if (server?.listening) {
      await new Promise(done => {server.closeIdleConnections(); server.close(done);});
    }
    await configured?.close();
  } finally {
    clearTimeout(timeout);
  }
}

try {
  let env = parse(await readFile('.env.supabase-mock', 'utf8'));
  for (const file of ['.env.auth', '.env.maps', '.env.geoapify', '.env.p3-enrichment']) {
    try {env = {...env, ...parse(await readFile(file, 'utf8'))};}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  env = {
    ...env, ...process.env,
    NODE_ENV: 'development', BIND_HOST: '127.0.0.1', PORT: '3002', XLAND_API_MODE: 'api',
    MAPS_PLANNING_ENABLED: process.env.MAPS_PLANNING_ENABLED ?? 'true',
    // Public share links continue to use the deployed HTTPS pages for the same demo data.
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? 'https://xland-server-production.up.railway.app',
  };
  configured = await runtime(env);
  server = configured.app.listen(3002, '127.0.0.1');
  await new Promise((done, reject) => {server.once('listening', done); server.once('error', reject);});
  const response = await fetch('http://127.0.0.1:3002/health/ready', {signal: AbortSignal.timeout(15000)});
  if (response.status !== 200) throw new Error('Readiness failed');
  console.log('Xland local API ready: http://localhost:3002/api/v1');
  console.log('Android Emulator API: http://10.0.2.2:3002/api/v1');
  console.log('Keep this terminal open. Ctrl+C stops the server. Source changes restart it automatically.');
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
} catch (error) {
  const code = ['ENOENT', 'EADDRINUSE', 'ECONNREFUSED'].includes(error.code) ? error.code : 'CONFIG_OR_READINESS_FAILED';
  console.error(`Local API failed (${code}). Check private .env files, database connectivity and port 3002.`);
  await stop();
  process.exitCode = 1;
}
