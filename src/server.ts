import 'dotenv/config';
import { runtime } from './runtime.js';
import { parseEnvironment } from './config/environment.js';

const env = parseEnvironment(process.env);
const configured=await runtime(process.env);
const server = configured.app.listen(env.port, '0.0.0.0', () => {
  console.info(JSON.stringify({ event: 'server_started', port: env.port, phase: 2, mode:process.env.XLAND_API_MODE??'api' }));
});
function shutdown() {
  server.close(() => {void configured.close().then(()=>process.exit(0));});
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
