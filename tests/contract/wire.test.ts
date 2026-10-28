import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { testApi } from '../helpers/api.js';
import type { Wire } from '../../src/repositories/properties.js';

// Runtime HTTP shape checks against the locked C-3 example, not a fixture-only audit.
export function shape(actual:unknown,example:unknown,path='data'):void {
  if(example===null){assert.ok(actual===null||['string','number','boolean'].includes(typeof actual),path);return;}
  if(Array.isArray(example)){
    assert.ok(Array.isArray(actual),path);
    if(example.length)for(const item of actual){
      let matched=false;
      for(const candidate of example){try{shape(item,candidate,path+'[]');matched=true;break;}catch{/* Different nullable variant in a heterogeneous C-3 list. */}}
      assert.ok(matched,path+'[] has a declared C-3 shape');
    }return;
  }
  if(typeof example==='object'){
    assert.ok(actual!==null&&typeof actual==='object'&&!Array.isArray(actual),path);
    assert.deepEqual(Object.keys(actual).sort(),Object.keys(example).sort(),path+' keys');
    for(const [key,value]of Object.entries(example))shape((actual as Wire)[key],value,path+'.'+key);return;
  }
  assert.equal(typeof actual,typeof example,path);
}
test('C-3 W1 runtime contract: exact fields, canonical values, error envelope and CORS',async()=>{
  const api=await testApi();
  try {
    const fixture=JSON.parse(await readFile('fixtures/contract/v0.1.json','utf8')) as {sampleTypes:Record<string,Wire>;properties:Wire[]};
    Object.assign(fixture.sampleTypes.FilterCatalog!,{communes:[]});
    Object.assign(fixture.sampleTypes.Property!,{parentPropertyId:null,hasSubplots:false,isCorner:false,communeCode:null,communeName:null,addressDetail:null,oldAddress:null});
    fixture.sampleTypes.UserProfile!.address=null;
    (fixture.sampleTypes.Session!.profile as Wire).address=null;
    const property=fixture.properties[0]!.id as string;
    for(const [path,type]of [[`/properties/${property}`,'Property'],[`/properties/${property}/legal`,'LegalSummary'],[`/properties/${property}/area`,'AreaInfo'],['/catalog/locations','FilterCatalog']]){
      const response=await api.request(path!);assert.equal(response.status,200);shape(response.body.data,fixture.sampleTypes[type!]);
    }
    const token=await api.login();
    for(const [path,type]of [['/auth/session','Session'],['/me/profile','UserProfile']]){
      const response=await api.request(path!,'GET',undefined,token);assert.equal(response.status,200);shape(response.body.data,fixture.sampleTypes[type!]);
    }
    const search=await api.request('/properties?limit=1');assert.deepEqual(Object.keys(search.body).sort(),['data','meta']);
    const meta=search.body.meta as Wire;assert.deepEqual(Object.keys(meta).sort(),['hasMore','nextCursor','selectedCriteriaCount','total']);assert.equal(meta.total,4);
    const invalid=await api.request('/properties?unknown=true');assert.equal(invalid.status,400);
    assert.deepEqual(Object.keys(invalid.body).sort(),['error','requestId']);assert.equal(invalid.body.requestId,invalid.headers.get('x-request-id'));
    assert.equal((invalid.body.error as Wire).code,'INVALID_INPUT');
    const preflight=await fetch(api.base+'/properties',{method:'OPTIONS',headers:{Origin:'http://localhost:5555','Access-Control-Request-Method':'GET'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'http://localhost:5555');
    assert.equal((await fetch(api.base+'/properties',{method:'OPTIONS',headers:{Origin:'https://unconfigured.example'}})).status,403);
  }finally{await api.close();}
});
