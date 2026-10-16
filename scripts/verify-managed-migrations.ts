import {readFile,writeFile}from'node:fs/promises';
import {randomBytes}from'node:crypto';
import pg from'pg';
import {migrate}from'../src/repositories/migrations.js';
import {seed,loadFixture,randomTestAccount}from'../src/repositories/seed.js';
import {Database}from'../src/repositories/database.js';
const cluster=JSON.parse(await readFile('.local/cluster.json','utf8')) as {port:number;password:string};
const run=JSON.parse(await readFile('.local/w2-run.json','utf8')) as {evidence:string};
const options={host:'127.0.0.1',port:cluster.port,user:'postgres',password:cluster.password};
const admin=new pg.Pool({...options,database:'postgres'});const suffix=randomBytes(6).toString('hex');const role='xland_manager_probe_'+suffix;const name='xland_test_managed_'+suffix;const password=randomBytes(24).toString('base64url');
try{
  // Only this new isolated DB/role is provisioned; existing cluster runtime roles retain their attributes.
  await admin.query(`CREATE ROLE ${role} LOGIN CREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
  for(const runtime of ['xland_api','xland_auth','xland_payment','xland_seed']){
    if((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[runtime])).rowCount)await admin.query(`GRANT ${runtime} TO ${role} WITH ADMIN TRUE,SET TRUE,INHERIT FALSE`);
  }
  await admin.query(`CREATE DATABASE ${name} OWNER ${role} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
}finally{await admin.end();}
const connectionString=`postgresql://${role}:${password}@127.0.0.1:${cluster.port}/${name}`;
const pool=new pg.Pool({connectionString});
try{
  const migrations=await migrate(pool);const fixture=await loadFixture();const account={...randomTestAccount(),id:String(fixture.sampleTypes.UserProfile!.id)};
  await seed(pool,[account]);await seed(pool,[account]);
  const db=new Database(connectionString);
  try{const runtime=await db.transaction('xland_api',null,async c=>(await c.query("SELECT current_user role,(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) bypass,(SELECT count(*)::int FROM xland.properties) properties")).rows[0]);
    const result={timestamp:new Date().toISOString(),environment:'isolated-local-nonsuperuser',database:name,migrations,managerNonSuperuser:true,managerNonBypass:true,seedReplay:true,runtime};
    await writeFile(run.evidence+'/managed-migration-compatibility.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await db.close();}
}finally{await pool.end();}
