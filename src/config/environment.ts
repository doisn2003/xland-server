export interface Environment {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string | undefined;
}

/** Railway pilot has one public reverse proxy. Never trust arbitrary forwarded chains. */
export function trustedProxyHops(env: NodeJS.ProcessEnv): 0 | 1 {
  const value = env.TRUST_PROXY_HOPS ?? '0';
  if (value !== '0' && value !== '1') throw new Error('TRUST_PROXY_HOPS must be 0 or 1');
  return value === '1' ? 1 : 0;
}

export function parseEnvironment(env: NodeJS.ProcessEnv): Environment {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV is invalid');
  }
  const rawPort = env.PORT ?? '3000';
  if (!/^\d+$/.test(rawPort)) throw new Error('PORT is invalid');
  const port = Number(rawPort);
  if (port < 1 || port > 65535) throw new Error('PORT is invalid');
  const databaseUrl = env.DATABASE_URL;
  if (nodeEnv === 'production' && !databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
        throw new Error();
      }
    } catch {
      throw new Error('DATABASE_URL is invalid');
    }
  }
  return { nodeEnv: nodeEnv as Environment['nodeEnv'], port, databaseUrl };
}
