import type { PoolClient } from 'pg';

/** Persistent fixed windows; callers must COMMIT even when this returns false. */
export async function takeAuthBudget(c:PoolClient,key:Buffer,limit:number,seconds:number,now:Date):Promise<boolean> {
  const result=await c.query<{hits:number}>(`INSERT INTO xland.auth_rate_buckets(bucket_key,hits,expires_at) VALUES($1,1,$2)
    ON CONFLICT(bucket_key) DO UPDATE SET
      hits=CASE WHEN auth_rate_buckets.expires_at<=$3 THEN 1 ELSE LEAST(auth_rate_buckets.hits+1,$4+1) END,
      expires_at=CASE WHEN auth_rate_buckets.expires_at<=$3 THEN $2 ELSE auth_rate_buckets.expires_at END
    RETURNING hits`,[key,new Date(now.getTime()+seconds*1000),now,limit]);
  return result.rows[0]!.hits<=limit;
}
