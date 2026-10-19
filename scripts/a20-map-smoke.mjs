import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:3004';
const checks=[];
async function get(path,status=200,headers={}) {
  const r=await fetch(base+path,{headers,signal:AbortSignal.timeout(20000)});assert.equal(r.status,status,path);
  checks.push({path,status:r.status});return r;
}
try {
  await get('/health/ready');
  const caps=await (await get('/api/v1/auth/capabilities')).json();assert.equal(caps.data.google.enabled,true);
  const properties=await (await get('/api/v1/properties?limit=50')).json();
  assert.equal(properties.data.length,20);const regions=new Set();let map;
  for(const property of properties.data) {
    const body=await (await get(`/api/v1/properties/${property.id}/area-map`)).json();map=body.data;
    assert.equal(map.availability,'ready');assert.equal(map.provider,'geoapify');assert.equal(map.embedPageUrl,null);
    assert.equal(map.tilePathTemplate,'/maps/tiles/{z}/{x}/{y}.png');assert.ok(!JSON.stringify(map).includes('apiKey'));
    assert.equal(new URL(map.externalDirectionsUrl).searchParams.get('destination'),map.areaLabel);regions.add(map.areaLabel);
  }
  const first=properties.data[0].id;
  await get(`/api/v1/properties/${first}/area-map`,401,{authorization:'Bearer invalid-proof'});
  await get('/api/v1/properties/not-uuid/area-map',400);
  await get('/api/v1/properties/11111111-1111-4111-8111-111111111111/area-map',404);
  await get(`/api/v1/properties/${first}/area-map?address=anything`,400);
  await get('/maps/embed/test',404);
  await get(`/api/v1/properties/${first}/area`);
  await get('/api/v1/feed?limit=2');
  const {centerLatitude:lat,centerLongitude:lon}=map.publicArea,z=12;
  const x=Math.floor((lon+180)/360*2**z),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
  const response=await get(`/maps/tiles/${z}/${x}/${y}.png`);assert.match(response.headers.get('content-type'),/image\/png/);
  const tile=Buffer.from(await response.arrayBuffer());assert.equal(tile.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const result={status:'PASS',time:new Date().toISOString(),propertiesReady:properties.data.length,regions:[...regions],googleLoginStillEnabled:true,tileBytes:tile.length,checks};
  await writeFile('../brain/logs/agent-a/A20_2026-10-19/runtime-smoke.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({status:'PASS',propertiesReady:20,regions:[...regions],checks:checks.length,tileBytes:tile.length}));
}catch(error){console.error(JSON.stringify({status:'FAIL',code:error.code??'CHECK_FAILED',checksCompleted:checks.length}));process.exitCode=1;}
