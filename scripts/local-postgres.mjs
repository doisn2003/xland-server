import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pg_ctl = process.platform === 'win32' ? (await import('@embedded-postgres/windows-x64')).pg_ctl : undefined;
const execute = promisify(execFile);

export async function localPostgres() {
  const dir = resolve('.local');
  await mkdir(dir, { recursive: true });
  let config;
  try { config = JSON.parse(await readFile(resolve(dir,'cluster.json'),'utf8')); }
  catch { config = { port: 55439, password: randomBytes(32).toString('base64url') }; await writeFile(resolve(dir,'cluster.json'),JSON.stringify(config),{mode:0o600}); }
  const postgres = new EmbeddedPostgres({ databaseDir: resolve(dir,'postgres'), user:'postgres', password:config.password,
    port:config.port, persistent:true, authMethod:'scram-sha-256',
    postgresFlags:['-h','127.0.0.1'], initdbFlags:['--encoding=UTF8','--locale=C'], onLog:()=>{}, onError:()=>{} });
  let wasStarted = false;
  const rootUrl = `postgresql://postgres:${config.password}@127.0.0.1:${config.port}/postgres`;
  let probe = new pg.Client({connectionString:rootUrl,connectionTimeoutMillis:1000});
  try { await probe.connect(); await probe.end(); }
  catch {
    await probe.end().catch(()=>{});
    try { await readFile(resolve(dir,'postgres','PG_VERSION')); } catch { await postgres.initialise(); }
    if (process.platform === 'win32') {
      // pg_ctl launches a restricted Windows token; direct postgres spawn rejects Administrator.
      await execute(pg_ctl, ['-D',resolve(dir,'postgres'),'-l',resolve(dir,'postgres.log'),'-o',`-p ${config.port} -h 127.0.0.1`,'-w','start'], {windowsHide:true});
    } else { await postgres.start(); }
    wasStarted=true;
  }
  return { rootUrl, config, postgres, wasStarted, stop: async()=>{if(wasStarted){
    if(process.platform==='win32')await execute(pg_ctl,['-D',resolve(dir,'postgres'),'-m','fast','-w','stop'],{windowsHide:true});
    else await postgres.stop();
  }} };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/local-postgres.mjs')) {
  const local=await localPostgres();
  console.log(JSON.stringify({status:'running',host:'127.0.0.1',port:local.config.port,environment:'isolated-local-postgresql',credentials:'private .local/cluster.json'}));
  const close=async()=>{await local.stop();process.exit(0);};
  process.once('SIGINT',close);process.once('SIGTERM',close);
  setInterval(()=>{},1000);
}
