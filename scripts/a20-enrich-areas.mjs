import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parse} from 'dotenv';
import {databaseTarget} from '../src/config/database-target.ts';
import {Database} from '../src/repositories/database.ts';
import {PostgresMapStore} from '../src/maps/geoapify_store.ts';
import {GeoapifyAreaMapService} from '../src/maps/geoapify_maps.ts';
import {geoapifyConfig} from '../src/maps/geoapify_config.ts';

// Owner explicitly permits selecting areas for the existing mock dataset (A-20).
// These are assigned sample regions, never assertions about actual parcels.
const env={...parse(await readFile('.env.supabase-mock','utf8')),...parse(await readFile('.env.geoapify','utf8'))};
const target=databaseTarget(env,false);if(target.environment!=='supabase_mock')throw new Error('Wrong target');
const db=new Database(target.connectionString);
const maps=new GeoapifyAreaMapService(geoapifyConfig(env),new PostgresMapStore(db));
const assignments=[['Hà Nội','Xã Hòa Lạc'],['Hưng Yên','Phường Phố Hiến'],['Bắc Ninh','Phường Võ Cường'],['Đà Nẵng','Phường Hòa Cường']];
try {
  const checked=[];
  for(const [province,commune] of assignments) {
    const map=await maps.presentation('mock-area-check',{commune,province});
    if(map.availability!=='ready')throw new Error('Unresolved sample region');
    checked.push({province,commune,publicArea:map.publicArea});
  }
  const c=await db.pool.connect();
  let updated;
  try {
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(783134221)');
    const rows=(await c.query('SELECT id,title,province,commune_name,is_illustrative FROM xland.properties ORDER BY id FOR UPDATE')).rows;
    if(rows.length!==20||rows.some(r=>!r.is_illustrative||!assignments.some(([province])=>province===r.province)))throw new Error('Unexpected mock dataset');
    await mkdir('.local',{recursive:true});
    const journal='.local/a20-areas-preimages.json';
    try{await writeFile(journal,JSON.stringify({time:new Date().toISOString(),rows},null,2),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
    updated=[];
    for(const [province,commune] of assignments) {
      const result=await c.query('UPDATE xland.properties SET commune_name=$1 WHERE province=$2 AND commune_name IS NULL AND is_illustrative=true RETURNING id',[commune,province]);
      updated.push({province,commune,ids:result.rows.map(r=>r.id)});
    }
    await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  const dir='../brain/logs/agent-a/A20_2026-10-19';await mkdir(dir,{recursive:true});
  const result={time:new Date().toISOString(),mockAssignmentAuthorized:true,preciseCoordinatesWritten:false,checked,updated};
  await writeFile(dir+'/mock-areas.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({assigned:updated.map(({province,commune,ids})=>({province,commune,count:ids.length})),allProviderRegionsReady:true}));
}catch{console.error('MOCK_AREA_ASSIGNMENT_FAILED_REDACTED');process.exitCode=1;}finally{await db.close();}
