import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/app.js';
import { geoapifyConfig } from '../../src/maps/geoapify_config.js';
import { namedArea, selectAdministrativeArea, GeoapifyAreaMapService, geoapifyTileRouter } from '../../src/maps/geoapify_maps.js';
import type { MapStore } from '../../src/maps/geoapify_store.js';

const config = geoapifyConfig({MAPS_GEOAPIFY_ENABLED:'true', MAPS_GEOAPIFY_API_KEY:'synthetic_key_123456789'});
const input = {commune:'Phường Long Biên',province:'Thành phố Hà Nội'};
const feature = {lat:21.03,lon:105.88,country_code:'vn',result_type:'suburb',state:'Hà Nội',suburb:'Long Biên',place_id:'one'};
const png = Buffer.from('89504e470d0a1a0a00000000','hex');
class MemoryStore implements MapStore {
  values=new Map<string,unknown>(); used=0; allowed=true;
  async get(key:string) { return this.values.get(key)??null; }
  async put(key:string,value:object) { this.values.set(key,value); }
  async reserve(cost:number,cap:number) { if(!this.allowed||this.used+cost>cap*4)return false;this.used+=cost;return true; }
}
test('Free config defaults off and caps requested spend below free quota',()=>{
  assert.equal(geoapifyConfig({}).enabled,false);
  assert.equal(geoapifyConfig({MAPS_GEOAPIFY_ENABLED:'true'}).enabled,false);
  assert.equal(geoapifyConfig({MAPS_GEOAPIFY_DAILY_CREDITS:'999999'}).dailyCredits,2400);
});
test('names normalize accents/prefixes; no street input or coordinates',()=>{
  assert.equal(namedArea(input)?.key,namedArea({commune:'phường Long Biên',province:'Hà Nội'})?.key);
  for(const commune of [null,'','Hòa Lạc','Số 12 đường A','21.03,105.88','Phường Long Biên, số 12']) {
    assert.equal(namedArea({commune,province:'Hà Nội'}),null);
  }
  assert.ok(namedArea({commune:'Xã Thụy Hương',province:'Thành phố Hà Nội'}));
  assert.ok(namedArea({commune:'Xã Phố Nối',province:'Tỉnh Hưng Yên'}));
  assert.notEqual(namedArea({commune:'Xã Phố Nối',province:'Hưng Yên'})?.key,namedArea({commune:'Phường Phố Nối',province:'Hưng Yên'})?.key);
});
test('reject ambiguous, wrong province, street/POI and country results; never choose first',()=>{
  const area=namedArea(input)!;
  assert.equal(selectAdministrativeArea({results:[feature]},area).availability,'ready');
  for(const results of [[],[feature,{...feature,place_id:'two',lat:21.04}],[{...feature,state:'Hưng Yên'}],
    [{...feature,result_type:'amenity'}],[{...feature,street:'A'}],[{...feature,country_code:'cn'}]]) {
    assert.equal(selectAdministrativeArea({results},area).availability,'unavailable');
  }
});
test('coalesced geocoding persists cache and Google links use name only, not parcel coordinates',async()=>{
  const store=new MemoryStore();let calls=0;
  const fetcher:typeof fetch=async(url)=>{
    calls++;const parsed=new URL(String(url));
    assert.equal(parsed.searchParams.get('filter'),'countrycode:vn');
    assert.equal(parsed.searchParams.get('type'),'locality');
    assert.equal(parsed.searchParams.get('city'),input.commune);
    assert.equal(parsed.searchParams.get('state'),input.province);
    return Response.json({results:[feature]});
  };
  const maps=new GeoapifyAreaMapService(config,store,fetcher);
  const [a,b]=await Promise.all([maps.presentation('a',input),maps.presentation('b',input)]);
  assert.equal(calls,1);assert.equal(store.used,4);
  assert.equal(a.availability,'ready');assert.deepEqual(a.publicArea,b.publicArea);
  assert.equal(a.tilePathTemplate,'/maps/tiles/{z}/{x}/{y}.png');
  assert.equal(new URL(a.externalDirectionsUrl!).searchParams.get('destination'),namedArea(input)!.label);
  assert.ok(!JSON.stringify(a).includes(config.apiKey));
  await new GeoapifyAreaMapService(config,store,fetcher).presentation('c',input);
  assert.equal(calls,1);
});
test('missing names/key, ambiguity and quota failure keep truthful fallback',async()=>{
  const store=new MemoryStore();let calls=0;
  const fetcher:typeof fetch=async()=>{calls++;return Response.json({results:[]});};
  const off=new GeoapifyAreaMapService({...config,enabled:false},store,fetcher);
  assert.equal((await off.presentation('a',input)).availability,'unconfigured');
  assert.ok((await off.presentation('a',input)).externalAreaMapUrl);
  const maps=new GeoapifyAreaMapService(config,store,fetcher);
  assert.equal((await maps.presentation('a')).availability,'invalid_area');assert.equal(calls,0);
  const unavailable=await maps.presentation('a',input);
  assert.equal(unavailable.availability,'unavailable');assert.equal(unavailable.publicArea,null);assert.ok(unavailable.externalDirectionsUrl);
  store.values.clear();store.allowed=false;
  const capped=await maps.presentation('a',input);
  assert.match(capped.notice,/hạn mức/);assert.ok(!capped.notice.includes(config.apiKey));
});
test('tile cache and single-flight charge once; route rejects arbitrary URLs and coordinates',async()=>{
  const store=new MemoryStore();let calls=0;
  const maps=new GeoapifyAreaMapService(config,store,async()=>{calls++;return new Response(png,{headers:{'content-type':'image/png'}});});
  await Promise.all([maps.tile(12,1000,1000),maps.tile(12,1000,1000)]);
  await maps.tile(12,1000,1000);assert.equal(calls,1);assert.equal(store.used,1);
  const server=createApp({checkReadiness:async()=>true,publicPages:geoapifyTileRouter(maps)}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/maps/tiles/12/1000/1000.png`)).status,200);
    for(const path of ['/maps/tiles/17/1/1.png','/maps/tiles/6/64/1.png','/maps/tiles/6/1/-1.png','/maps/tiles/6/1/1.png?url=https://evil.test']) {
      assert.equal((await fetch(base+path)).status,400);
    }
    store.allowed=false;
    assert.equal((await fetch(`${base}/maps/tiles/12/1000/1001.png`)).status,429);
    assert.equal(calls,1);
  } finally {server.close();await once(server,'close');}
});
test('provider failure redacts key/url and never claims map ready',async()=>{
  const maps=new GeoapifyAreaMapService(config,new MemoryStore(),async()=>{throw new Error('secret '+config.apiKey);});
  const result=await maps.presentation('a',input);
  assert.equal(result.availability,'unavailable');assert.equal(result.tilePathTemplate,null);
  assert.ok(!JSON.stringify(result).includes(config.apiKey));assert.ok(result.externalAreaMapUrl);
});
test('municipality results with omitted/misclassified state require matching city or ISO code',()=>{
  const hanoi=namedArea({commune:'Xã Hòa Lạc',province:'Hà Nội'})!;
  const hoaLac={...feature,name:'Xã Hòa Lạc',suburb:'Xã Hòa Lạc',state:'Xã Hòa Lạc',city:'Hà Nội',iso3166_2:'VN-HN'};
  assert.equal(selectAdministrativeArea({results:[hoaLac]},hanoi).availability,'ready');
  const daNang=namedArea({commune:'Phường Hòa Cường',province:'Đà Nẵng'})!;
  const hoaCuong={...feature,name:'Phường Hòa Cường',suburb:'Phường Hòa Cường',state:undefined,city:'Phường Hòa Cường',iso3166_2:'VN-DN',lat:16.04,lon:108.21};
  assert.equal(selectAdministrativeArea({results:[hoaCuong]},daNang).availability,'ready');
  assert.equal(selectAdministrativeArea({results:[{...hoaCuong,iso3166_2:'VN-HN'}]},daNang).availability,'unavailable');
  assert.equal(selectAdministrativeArea({results:[{...hoaCuong,state:'Hưng Yên'}]},daNang).availability,'unavailable');
});

test('Hai Phong ward results accept VN-HP only when province evidence agrees',()=>{
  const area=namedArea({commune:'Phường Hải An',province:'Hải Phòng'})!;
  const ward={lat:20.8247021,lon:106.7215727,country_code:'vn',result_type:'city',
    city:'Phường Hải An',name:'Phường Hải An',iso3166_2:'VN-HP'};
  assert.equal(selectAdministrativeArea({results:[ward]},area).availability,'ready');
  for(const invalid of [{...ward,iso3166_2:'VN-HN'},{...ward,state:'Hà Nội'},
    {...ward,country_code:'cn'},{...ward,name:'Xã Hải An',city:'Xã Hải An'}]) {
    assert.equal(selectAdministrativeArea({results:[invalid]},area).availability,'unavailable');
  }
});
