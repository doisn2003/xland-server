import type { Pool,PoolClient } from 'pg';

export interface AuthRetentionOptions { apply?:boolean;batchSize?:number;now?:Date }
export interface AuthRetentionBatch { eligibleInBatch:number;moreEligible:boolean;deleted:number }
export interface AuthRetentionResult {
  apply:boolean;batchSize:number;cutoff:string;
  challenges:AuthRetentionBatch;rateBuckets:AuthRetentionBatch;
}
/** Operator-owned connection only. No extra grants or auth/API role escalation. */
export async function authRetentionUsing(c:PoolClient,options:AuthRetentionOptions={}):Promise<AuthRetentionResult> {
  const batchSize=options.batchSize??200,now=options.now??new Date();
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>500||!Number.isFinite(now.getTime()))throw new Error('Invalid auth retention options');
  // Retain both expired OTP/request digests and spent rate windows for >=24h.
  // Active windows (including the 30-day cap) are never reset by maintenance.
  const cutoff=new Date(now.getTime()-86400000);
  const challenges=await c.query<{count:number}>(`SELECT count(*)::integer AS count FROM
    (SELECT 1 FROM xland.auth_otp_challenges WHERE expires_at<$1 ORDER BY expires_at,id LIMIT $2) eligible`,[cutoff,batchSize+1]);
  const rates=await c.query<{count:number}>(`SELECT count(*)::integer AS count FROM
    (SELECT 1 FROM xland.auth_rate_buckets WHERE expires_at<$1 ORDER BY expires_at,bucket_key LIMIT $2) eligible`,[cutoff,batchSize+1]);
  const summary=(count:number):AuthRetentionBatch=>({eligibleInBatch:Math.min(count,batchSize),moreEligible:count>batchSize,deleted:0});
  const result:AuthRetentionResult={apply:options.apply===true,batchSize,cutoff:cutoff.toISOString(),
    challenges:summary(challenges.rows[0]!.count),rateBuckets:summary(rates.rows[0]!.count)};
  if(!options.apply)return result;
  const deletedChallenges=await c.query(`WITH expired AS
    (SELECT id FROM xland.auth_otp_challenges WHERE expires_at<$1 ORDER BY expires_at,id LIMIT $2 FOR UPDATE SKIP LOCKED)
    DELETE FROM xland.auth_otp_challenges c USING expired WHERE c.id=expired.id`,[cutoff,batchSize]);
  const deletedRates=await c.query(`WITH expired AS
    (SELECT bucket_key FROM xland.auth_rate_buckets WHERE expires_at<$1 ORDER BY expires_at,bucket_key LIMIT $2 FOR UPDATE SKIP LOCKED)
    DELETE FROM xland.auth_rate_buckets b USING expired WHERE b.bucket_key=expired.bucket_key`,[cutoff,batchSize]);
  result.challenges.deleted=deletedChallenges.rowCount??0;
  result.rateBuckets.deleted=deletedRates.rowCount??0;
  return result;
}

export async function runAuthRetention(pool:Pool,options:AuthRetentionOptions={}):Promise<AuthRetentionResult> {
  const client=await pool.connect();
  try {
    await client.query(options.apply?'BEGIN':'BEGIN READ ONLY');
    await client.query("SET LOCAL lock_timeout='5s'");
    const result=await authRetentionUsing(client,options);
    await client.query('COMMIT');
    return result;
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}
