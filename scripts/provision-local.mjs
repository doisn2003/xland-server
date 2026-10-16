import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { parse } from 'dotenv';
import pg from 'pg';
import { localPostgres } from './local-postgres.mjs';
import { migrate } from '../src/repositories/migrations.ts';
import { seed, loadFixture } from '../src/repositories/seed.ts';

const cluster=await localPostgres();
const root=new pg.Pool({connectionString:cluster.rootUrl});
const database='xland_dev_p2';
try {if(!(await root.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount)await root.query(`CREATE DATABASE ${database} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);}finally{await root.end();}
const connectionString=`postgresql://postgres:${cluster.config.password}@127.0.0.1:${cluster.config.port}/${database}`;
let values;
try {
  const existing=await readFile('.env.local','utf8');
  if(!existing.startsWith('# XLAND_LOCAL_P2_GENERATED'))throw new Error('Existing .env.local is not owned by this provisioner');
  values=parse(existing);
}catch(error){
  if(error.code!=='ENOENT')throw error;
  const fingerprint=createHash('sha256').update('127.0.0.1/'+database).digest('hex').slice(0,16);
  values={DATABASE_URL:connectionString,DATABASE_ENVIRONMENT:'development',DATABASE_APPROVED_FINGERPRINT:fingerprint,NODE_ENV:'development',PORT:'3000',CORS_ORIGINS:'http://localhost:5555,http://127.0.0.1:5555',CURSOR_SECRET:randomBytes(32).toString('base64url'),DEMO_USERNAME:'local-'+randomBytes(6).toString('hex'),DEMO_PASSWORD:randomBytes(24).toString('base64url')};
  await writeFile('.env.local','# XLAND_LOCAL_P2_GENERATED — local only, do not commit/share\n'+Object.entries(values).map(([key,value])=>key+'='+value).join('\n')+'\n',{mode:0o600});
}
if(values.DATABASE_URL!==connectionString)throw new Error('Local environment target changed; manual review required');
const pool=new pg.Pool({connectionString});
try {
  const migrations=await migrate(pool);
  const fixture=await loadFixture();
  const account={id:String(fixture.sampleTypes.UserProfile.id),username:values.DEMO_USERNAME,password:values.DEMO_PASSWORD};
  const once=await seed(pool,[account]);const twice=await seed(pool,[account]);
  console.log(JSON.stringify({environment:'isolated-local-development',database,migrations,once,twice,baseUrl:'http://127.0.0.1:3000/api/v1',credentialLocation:'private .env.local; never print to Markdown',backup:'new isolated DB; migration transaction rollback; no DROP/TRUNCATE'}));
}finally{await pool.end();}
