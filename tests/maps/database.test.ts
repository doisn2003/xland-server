import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Database} from '../../src/repositories/database.js';
import {PostgresMapStore} from '../../src/maps/geoapify_store.js';
import {seed,loadFixture,randomTestAccount} from '../../src/repositories/seed.js';
import {CoreService} from '../../src/services/core.js';
import {AuthService} from '../../src/services/auth.js';
import {CursorCodec} from '../../src/services/cursor.js';
import {areaMapApiRouter} from '../../src/maps/map_routes.js';
import {GeoapifyAreaMapService} from '../../src/maps/geoapify_maps.js';
import {geoapifyConfig} from '../../src/maps/geoapify_config.js';
import {createApp} from '../../src/app.js';
import {Router} from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
const value=process.env.XLAND_MAPS_TEST_DB;
test('isolated PostgreSQL: durable shared quota, cache expiry and permission isolation',{skip:!value},async()=>{
  const url=new URL(value!);
  assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/xland_test_maps_/);
  const db=new Database(value!,8);
  try {
    const first=new PostgresMapStore(db),second=new PostgresMapStore(db);
    const attempts=await Promise.all(Array.from({length:20},(_,i)=>(i%2?first:second).reserve(1,1)));
    assert.equal(attempts.filter(Boolean).length,4);
    assert.equal(await new PostgresMapStore(db).reserve(1,1),false);
    assert.equal(await first.reserve(1,2),true);
    const key='a'.repeat(64);
    await first.put(key,{publicArea:'shared-centre'},3600);
    assert.deepEqual(await second.get(key),{publicArea:'shared-centre'});
    await first.put(key,{publicArea:'expired'},-1);
    assert.equal(await second.get(key),null);
    for(const role of ['xland_api','xland_auth','xland_payment'] as const) {
      await assert.rejects(db.transaction(role,null,c=>c.query('SELECT * FROM xland.map_area_cache')));
      await assert.rejects(db.transaction(role,null,c=>c.query('UPDATE xland.map_daily_usage SET quarter_credits=0')));
    }
    await assert.rejects(db.transaction('xland_maps',null,c=>c.query('SELECT * FROM xland.user_identities')));
    const column=await db.pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='xland' AND table_name='properties' AND column_name='commune_name'");
    assert.equal(column.rows[0].is_nullable,'YES');
    const fixture=await loadFixture();
    await seed(db.pool,[{...randomTestAccount(),id:String(fixture.sampleTypes.UserProfile!.id)},randomTestAccount()]);
    const property=(await db.pool.query('SELECT id FROM xland.properties ORDER BY id LIMIT 1')).rows[0].id;
    await db.pool.query("UPDATE xland.properties SET commune_name='Phường Long Biên',province='Hà Nội',approximate_lat=NULL,approximate_lng=NULL,approximate_radius_m=NULL WHERE id=$1",[property]);
    const core=new CoreService(db,new AuthService(db),new CursorCodec(Buffer.alloc(32,1)));
    const maps=new GeoapifyAreaMapService(geoapifyConfig({}),first);
    const router=Router();router.use((_req,res,next)=>{res.locals.identity=null;next();});router.use(areaMapApiRouter(core,maps));
    const server=createApp({checkReadiness:async()=>true,api:router}).listen(0,'127.0.0.1');await once(server,'listening');
    try {
      const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/properties/${property}/area-map`);
      assert.equal(response.status,200);
      const body=await response.json() as {data:{availability:string;areaLabel:string}};
      assert.equal(body.data.availability,'unconfigured');assert.match(body.data.areaLabel,/Long Biên/);
      const area=await core.read(null,c=>core.properties.area(c,property));assert.equal(area.location,null);
      await assert.rejects(core.read(null,c=>c.query('SELECT lat,lng FROM xland.properties')));
    } finally {server.close();await once(server,'close');}
  } finally {await db.close();}
});
