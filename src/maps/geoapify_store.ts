import type { Database } from '../repositories/database.js';

export interface MapStore {
  get(key: string): Promise<unknown | null>;
  put(key: string, result: object, lifetimeSeconds: number): Promise<void>;
  reserve(quarterCredits: number, dailyCredits: number): Promise<boolean>;
}
export class PostgresMapStore implements MapStore {
  constructor(private readonly db: Database) {}
  get(key: string): Promise<unknown | null> {
    return this.db.transaction('xland_maps', null, async c =>
      (await c.query('SELECT result FROM xland.map_area_cache WHERE area_key=$1 AND expires_at>now()', [key])).rows[0]?.result ?? null, true);
  }
  async put(key: string, result: object, seconds: number): Promise<void> {
    await this.db.transaction('xland_maps', null, async c => {
      await c.query(`INSERT INTO xland.map_area_cache(area_key,result,expires_at) VALUES($1,$2,now()+$3*interval '1 second')
        ON CONFLICT(area_key) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at`, [key, JSON.stringify(result), seconds]);
    });
  }
  reserve(quarterCredits: number, dailyCredits: number): Promise<boolean> {
    return this.db.transaction('xland_maps', null, async c => {
      const result = await c.query(`INSERT INTO xland.map_daily_usage(usage_day,quarter_credits)
        VALUES((now() AT TIME ZONE 'UTC')::date,$1)
        ON CONFLICT(usage_day) DO UPDATE SET quarter_credits=map_daily_usage.quarter_credits+excluded.quarter_credits
        WHERE map_daily_usage.quarter_credits+excluded.quarter_credits<=$2 RETURNING quarter_credits`, [quarterCredits, dailyCredits * 4]);
      return result.rowCount === 1;
    });
  }
}
