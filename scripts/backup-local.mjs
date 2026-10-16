import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
const quoted=value=>'"'+value.replaceAll('"','""')+'"';
const projection=columns=>columns.map(r=>r.type==='bytea'?`encode(${quoted(r.name)},'base64') AS ${quoted(r.name)}`:['numeric','bigint','timestamp with time zone','timestamp without time zone','date','time without time zone'].includes(r.type)?`${quoted(r.name)}::text AS ${quoted(r.name)}`:quoted(r.name)).join(',');
const digestRows=rows=>createHash('sha256').update(JSON.stringify(rows.map(row=>JSON.stringify(row)).sort())).digest('hex');

export async function backupLocal(connectionString) {
  const url=new URL(connectionString);
  if(!['127.0.0.1','localhost','::1'].includes(url.hostname)||url.pathname!=='/xland_dev_p2')throw new Error('Local backup requires the owned isolated development DB');
  return backupApplication(connectionString,'isolated-local-development','xland_dev_p2');
}
export async function backupSupabaseMock(connectionString){
  const url=new URL(connectionString);const fingerprint=createHash('sha256').update(url.hostname+url.pathname).digest('hex').slice(0,16);
  if(fingerprint!=='03d6c297d77a1029')throw new Error('A-09 backup target mismatch');
  return backupApplication(connectionString,'supabase_mock','supabase_mock');
}
async function backupApplication(connectionString,environment,label){
  await mkdir('.backups',{recursive:true});
  // Embedded binaries omit pg_dump. Snapshot every application table consistently;
  // exact numeric/timestamp/bytea representations are preserved for a verified restore.
  const pool=new pg.Pool({connectionString});const c=await pool.connect();const tables=[];let migrations;
  try{
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    migrations=(await c.query('SELECT id,digest FROM xland_meta.migrations ORDER BY id')).rows;
    const names=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='xland' ORDER BY tablename")).rows;
    for(const {tablename:name}of names){
      const columns=(await c.query("SELECT column_name name,data_type type,is_generated generated FROM information_schema.columns WHERE table_schema='xland' AND table_name=$1 ORDER BY ordinal_position",[name])).rows.filter(r=>r.generated==='NEVER');
      const rows=(await c.query(`SELECT ${projection(columns)} FROM xland.${quoted(name)}`)).rows;
      tables.push({name,columns,rows});
    }
    await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();await pool.end();}
  const file=resolve('.backups',`${label}_${new Date().toISOString().replace(/[^0-9]/g,'')}.json`);
  await writeFile(file,JSON.stringify({format:'xland-logical-v1',createdAt:new Date().toISOString(),migrations,tables}),{mode:0o600});
  const bytes=await readFile(file);
  return {file,format:'xland-logical-v1',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,database:label,environment,tables:tables.length};
}
export async function restoreLogical(pool,file) {
  const snapshot=JSON.parse(await readFile(file,'utf8'));if(snapshot.format!=='xland-logical-v1')throw new Error('Unknown backup format');
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    const target=(await c.query('SELECT current_database() name')).rows[0].name;
    if(!target.startsWith('xland_test_restore_'))throw new Error('Restore requires a new isolated xland_test_restore_* database');
    for(const migration of snapshot.migrations){const actual=(await c.query('SELECT digest FROM xland_meta.migrations WHERE id=$1',[migration.id])).rows[0];if(actual?.digest!==migration.digest)throw new Error('Backup migration version/digest mismatch');}
    for(const table of snapshot.tables){if((await c.query(`SELECT 1 FROM xland.${quoted(table.name)} LIMIT 1`)).rowCount)throw new Error('Refuse restore into nonempty tables');}
    let pending=snapshot.tables.flatMap(table=>table.rows.map(row=>({table,row})));const expected=pending.length;let passes=0;
    while(pending.length){const next=[];let progress=0;
      for(const {table,row}of pending){
        const fields=table.columns.map(column=>({column,value:column.type==='bytea'&&row[column.name]!==null?Buffer.from(row[column.name],'base64'):column.type==='jsonb'?JSON.stringify(row[column.name]):row[column.name]}));
        await c.query('SAVEPOINT restore_row');
        try{await c.query(`INSERT INTO xland.${quoted(table.name)}(${fields.map(f=>quoted(f.column.name)).join(',')}) VALUES(${fields.map((_,i)=>'$'+(i+1)).join(',')})`,fields.map(f=>f.value));await c.query('RELEASE SAVEPOINT restore_row');progress++;}
        catch(error){await c.query('ROLLBACK TO SAVEPOINT restore_row');await c.query('RELEASE SAVEPOINT restore_row');if(error.code!=='23503')throw error;next.push({table,row});}
      }
      if(!progress)throw new Error('Backup has unresolved FK dependencies');pending=next;passes++;
    }
    for(const table of snapshot.tables){const actual=(await c.query(`SELECT ${projection(table.columns)} FROM xland.${quoted(table.name)}`)).rows;if(digestRows(actual)!==digestRows(table.rows))throw new Error('Restored table data digest mismatch');}
    await c.query('COMMIT');
    return {verified:true,dataDigestsMatch:true,database:target,tables:snapshot.tables.length,restoredRows:expected,passes};
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
