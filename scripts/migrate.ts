import 'dotenv/config';
import pg from 'pg';
import { databaseTarget } from '../src/config/database-target.js';
import { migrate } from '../src/repositories/migrations.js';
const target=databaseTarget(process.env, process.env.NODE_ENV==='test');
const pool=new pg.Pool({connectionString:target.connectionString,connectionTimeoutMillis:5000});
try { console.log(JSON.stringify({environment:target.environment,targetFingerprint:target.fingerprint,migrations:await migrate(pool)})); }
finally { await pool.end(); }
