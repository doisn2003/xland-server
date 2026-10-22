import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {Database} from '../src/repositories/database.ts';
import {databaseTarget} from '../src/config/database-target.ts';
import {migrate} from '../src/repositories/migrations.ts';
import {provisionAdmin} from '../src/admin/auth.ts';
import {AdminStorage} from '../src/admin/storage.ts';
import {backupSupabaseMock} from './backup-local.mjs';

const env={...parse(await readFile('.env.supabase-mock','utf8')),...parse(await readFile('.env.p3-enrichment','utf8')),...process.env};
const target=databaseTarget(env,false),db=new Database(target.connectionString);
try{
  const backup=await backupSupabaseMock(target.connectionString);
  if(createHash('sha256').update(await readFile(backup.file)).digest('hex')!==backup.sha256)throw new Error('Backup verification failed');
  const migrations=await migrate(db.pool);
  const account=await provisionAdmin(db,env.XLAND_ADMIN_USERNAME??'admin',env.XLAND_ADMIN_PASSWORD??'123456');
  await new AdminStorage(env).setup();
  console.log(JSON.stringify({migrations,account,backup:backup.file,storage:'ready',targetFingerprint:target.fingerprint}));
}finally{await db.close();}
