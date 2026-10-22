import pg from 'pg';
import type { PoolClient } from 'pg';

export class Database {
  readonly pool: pg.Pool;
  constructor(connectionString: string, max = 8) {
    this.pool = new pg.Pool({ connectionString, max, connectionTimeoutMillis: 5000, query_timeout: 10000,
      idleTimeoutMillis: 60000, application_name: 'xland-server' });
    this.pool.on('error', () => { console.error(JSON.stringify({ event: 'database_pool_error' })); });
  }
  async transaction<T>(role: 'xland_api' | 'xland_auth' | 'xland_payment' | 'xland_maps' | 'xland_admin', userId: string | null,
    work: (client: PoolClient) => Promise<T>, readOnly=false): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
      // Settings and role membership checks remain transaction-local and run
      // before application queries, without three separate network round trips.
      await client.query(`SELECT set_config('role', $1, true), set_config('TimeZone', 'UTC', true),
        set_config('xland.user_id', $2, true)`, [role, userId ?? '']);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async ready(): Promise<boolean> {
    return this.transaction('xland_api', null, async c => {
      await c.query('SELECT id FROM xland.properties LIMIT 1'); return true;
    }).catch(() => false);
  }
  async close(): Promise<void> { await this.pool.end(); }
}
