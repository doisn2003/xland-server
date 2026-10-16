import { createHash } from 'node:crypto';

export interface DatabaseTarget { connectionString: string; environment: 'test' | 'development'; fingerprint: string }
export function databaseTarget(env: NodeJS.ProcessEnv, test: boolean): DatabaseTarget {
  const value = test ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  const environment = test ? env.TEST_DATABASE_ENVIRONMENT : env.DATABASE_ENVIRONMENT;
  if (!value || environment !== (test ? 'test' : 'development')) {
    throw new Error('Database target must have an explicit isolated test/development classification');
  }
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database target');
  if (test && (value === env.DATABASE_URL || !url.pathname.startsWith('/xland_test_'))) {
    throw new Error('Tests require a dedicated xland_test_* database, separate from DATABASE_URL');
  }
  const fingerprint = createHash('sha256').update(url.hostname + url.pathname).digest('hex').slice(0, 16);
  if (!test && env.DATABASE_APPROVED_FINGERPRINT !== fingerprint) {
    throw new Error('Development migration target fingerprint must be approved explicitly');
  }
  return { connectionString: value, environment: test ? 'test' : 'development', fingerprint };
}
