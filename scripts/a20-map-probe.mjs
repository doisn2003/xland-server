import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {Database} from '../src/repositories/database.ts';
import {PostgresMapStore} from '../src/maps/geoapify_store.ts';
import {GeoapifyAreaMapService} from '../src/maps/geoapify_maps.ts';
import {geoapifyConfig} from '../src/maps/geoapify_config.ts';
const env={...parse(await readFile('.env.supabase-mock','utf8')),...parse(await readFile('.env.geoapify','utf8'))};
const db=new Database(env.DATABASE_URL),config=geoapifyConfig(env);
const maps=new GeoapifyAreaMapService(config,new PostgresMapStore(db));
try {
  if(!config.enabled)throw new Error('Provider not configured');
  const results=[];
  for(const [commune,province] of [['Xã Hòa Lạc','Hà Nội'],['Phường Phố Nối','Hưng Yên'],['Phường Võ Cường','Bắc Ninh'],['Phường Hòa Cường','Đà Nẵng'],['Phường Long Biên','Hà Nội'],['Xã Thụy Hương','Hà Nội']]) {
    const result=await maps.presentation('administrative-area-probe',{commune,province});
    results.push({commune,province,...result});
    console.log(JSON.stringify({commune,province,availability:result.availability}));
  }
  const ready=results.find(r=>r.publicArea!==null);
  if(!ready)throw new Error('No resolved areas');
  const lat=ready.publicArea.centerLatitude,lon=ready.publicArea.centerLongitude,z=12;
  const x=Math.floor((lon+180)/360*2**z),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
  const tile=await maps.tile(z,x,y);
  const dir='../brain/logs/agent-a/A20_2026-10-19';await mkdir(dir,{recursive:true});
  await writeFile(dir+'/geoapify-live.json',JSON.stringify({time:new Date().toISOString(),results,tileBytes:tile.length,realProvider:true},null,2));
  await writeFile(dir+'/geoapify-live-tile.png',tile);
  console.log(JSON.stringify({tileLoaded:true,tileBytes:tile.length}));
}catch{console.error('MAP_PROBE_FAILED_REDACTED');process.exitCode=1;}finally{await db.close();}
