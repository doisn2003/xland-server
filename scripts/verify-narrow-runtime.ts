import {readFile,writeFile} from 'node:fs/promises';import {randomBytes} from 'node:crypto';import assert from 'node:assert/strict';import pg from 'pg';import {databaseTarget} from '../src/config/database-target.js';import {Database} from '../src/repositories/database.js';import {evidenceDirectory} from '../src/config/evidence.js';
const context=JSON.parse(await readFile('.local/test-context.json','utf8')) as {connectionString:string;first:{id:string};second:{id:string}};
const target=databaseTarget({TEST_DATABASE_URL:context.connectionString,TEST_DATABASE_ENVIRONMENT:'test'},true);const url=new URL(target.connectionString);assert(['127.0.0.1','localhost'].includes(url.hostname));
const admin=new pg.Pool({connectionString:target.connectionString});const role='xland_runtime_w3_'+randomBytes(6).toString('hex'),password=randomBytes(32).toString('hex');let db:Database|undefined;
try{
 await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOINHERIT NOCREATEROLE NOCREATEDB NOBYPASSRLS`);
 await admin.query(`GRANT xland_api,xland_auth,xland_payment TO ${role} WITH INHERIT FALSE, SET TRUE`);
 url.username=role;url.password=password;db=new Database(url.toString(),1);
 await assert.rejects(db.pool.query('SELECT id FROM xland.properties'));
 await assert.rejects(db.pool.query('SET ROLE xland_seed'));
 assert.equal(await db.ready(),true);
 for(const user of [context.first.id,context.second.id]){
 const rows=await db.transaction('xland_api',user,c=>c.query('SELECT user_id FROM xland.user_settings'));assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].user_id,user);
 await assert.rejects(db.transaction('xland_api',user,c=>c.query('SELECT password_hash FROM xland.user_identities')));
 const state=(await db.pool.query("SELECT current_user role,current_setting('xland.user_id',true) id")).rows[0];assert.equal(state.role,role);assert(!state.id);
 }
 const guest=await db.transaction('xland_api',null,c=>c.query('SELECT user_id FROM xland.user_settings'));assert.equal(guest.rowCount,0);
 const rights=(await admin.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=$1',[role])).rows[0];assert(Object.values(rights).every(v=>v===false));
 await writeFile((await evidenceDirectory())+'/narrow-runtime.json',JSON.stringify({timestamp:new Date().toISOString(),environment:'isolated-local-test',testDatabase:url.pathname.slice(1),rights,bareAccessDenied:true,seedRoleDenied:true,actualLoginPool1OwnerGuestErrorIsolation:true,sharedCredentialChanged:false,remoteRoleCreated:false},null,2));console.log(JSON.stringify({event:'narrow_runtime_local_pass',remoteRoleCreated:false}));
}catch{console.error(JSON.stringify({event:'narrow_runtime_local_failed'}));process.exitCode=1;}finally{await db?.close();await admin.end();}
