import 'dotenv/config';
import { createApp } from './app.js';
import { parseEnvironment } from './config/environment.js';

const env = parseEnvironment(process.env);
// DB repository readiness is wired in Phase 2; liveness is not DB readiness.
const app = createApp({ checkReadiness: async () => false });
const server = app.listen(env.port, '0.0.0.0', () => {
  console.info(JSON.stringify({ event: 'server_started', port: env.port, phase: 1 }));
});
function shutdown() {
  server.close(() => process.exit(0));
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
