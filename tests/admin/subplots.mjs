import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testSubplots({req,db,token,source,writable,base,userToken}) {
  source=(await db.pool.query(`SELECT p.* FROM xland.properties p WHERE
    EXISTS(SELECT 1 FROM xland.property_media WHERE property_id=p.id AND usage IN ('gallery','area')) AND
    EXISTS(SELECT 1 FROM xland.property_documents WHERE property_id=p.id) AND
    EXISTS(SELECT 1 FROM xland.property_legal_items WHERE property_id=p.id) AND
    EXISTS(SELECT 1 FROM xland.property_nearby_amenities WHERE property_id=p.id) ORDER BY p.id LIMIT 1`)).rows[0];
  assert.ok(source,'A populated source dossier is required for inheritance QA');
  let parent=await req('/admin/properties','POST',{...writable('properties',source),code:'SUBPLOTS-QA',title:'Khu đất nhiều lô QA',area_m2:'1000',has_subplots:true,parent_property_id:null,approval_status:'approved',status:'listed'},token,201);
  for(const table of ['property_media','property_documents','property_legal_items','property_nearby_amenities']) {
    const rows=(await db.pool.query(`SELECT * FROM xland.${table} WHERE property_id=$1${table==='property_media'?" AND usage IN ('gallery','area')":''}`,[source.id])).rows;
    assert.ok(rows.length>0,table+' inheritance must exercise populated source data');
    for(const row of rows){
      row.id=randomUUID();row.property_id=parent.id;
      const keys=Object.keys(row);
      await db.pool.query(`INSERT INTO xland.${table}(${keys.map(k=>'"'+k+'"').join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));
    }
  }
  const children=[];
  for(let i=1;i<=5;i++){
    parent=await req('/admin/properties/'+parent.id,'GET',undefined,token);
    const child=await req(`/admin/properties/${parent.id}/children`,'POST',{_version:parent._version,code:`SUB-QA-${i}`,title:`Lô con ${i}`,area_m2:'100',price_total:String(1000000000+i),frontage_m:'5',is_corner:i===1},token,201);
    assert.equal(child.parent_property_id,parent.id);assert.equal(child.province_code,parent.province_code);assert.equal(child.approval_status,'pending');assert.equal(child.status,'paused');
    await req('/properties/'+child.id,'GET',undefined,undefined,404);
    children.push(await req('/admin/properties/'+child.id,'PATCH',{_version:child._version,approval_status:'approved',status:i===5?'sold':'listed'},token));
  }
  const publicParent=await req('/properties/'+parent.id);assert.equal(publicParent.hasSubplots,true);
  const visible=await req('/properties/'+children[0].id);assert.equal(visible.parentPropertyId,parent.id);assert.equal(visible.isCorner,true);assert.equal(visible.priceTotal,'1000000001');assert.equal('lat' in visible,false);
  await req(`/properties/${children[0].id}/saved`,'PUT',{},userToken);
  assert.ok((await req('/properties?savedOnly=true','GET',undefined,userToken)).some(p=>p.id===children[0].id));
  const getPage=async path=>{const r=await fetch(base+path);assert.equal(r.status,200);return r.json();};
  const first=await getPage(`/properties/${parent.id}/children?limit=4`);
  assert.equal(first.data.length,4);assert.equal(first.meta.total,5);assert.equal(first.meta.hasMore,true);
  const second=await getPage(`/properties/${parent.id}/children?limit=4&cursor=${encodeURIComponent(first.meta.nextCursor)}`);
  assert.equal(second.data.length,1);assert.equal(second.data[0].status,'sold');assert.equal(second.meta.hasMore,false);
  assert.ok(!(await req('/properties?query=SUB-QA')).length,'Children are grouped under their parent in discovery');
  await req(`/properties/${children[0].id}/children?cursor=${encodeURIComponent(first.meta.nextCursor)}`,'GET',undefined,undefined,400);
  parent=await req('/admin/properties/'+parent.id,'GET',undefined,token);
  await req('/admin/properties/'+parent.id,'PATCH',{_version:parent._version,has_subplots:false},token,400);
  await req('/admin/properties/'+parent.id,'PATCH',{_version:parent._version,area_m2:'499.999999'},token,400);
  await req(`/admin/properties/${parent.id}/children`,'POST',{_version:parent._version,code:'OVER-AREA',title:'Quá diện tích',area_m2:'500.000001',price_total:'1'},token,400);
  assert.equal((await req(`/admin/properties/${parent.id}/aggregate`,'GET',undefined,token)).subdivision.remaining_area_m2,'500.000000');
  // Nested subdivision, cycles and RLS all operate on the complete hierarchy.
  let child=await req('/admin/properties/'+children[0].id,'PATCH',{has_subplots:true},token);
  const grandchild=await req(`/admin/properties/${child.id}/children`,'POST',{_version:child._version,code:'SUB-NESTED',title:'Lô nhỏ bên trong',area_m2:'50',price_total:'20'},token,201);
  await req('/admin/properties/'+grandchild.id,'PATCH',{approval_status:'approved',status:'listed'},token);
  await req('/admin/properties/'+parent.id,'PATCH',{parent_property_id:child.id},token,400);
  await req('/admin/properties/'+parent.id,'PATCH',{parent_property_id:parent.id},token,400);
  await req('/admin/properties/'+parent.id,'PATCH',{approval_status:'pending'},token);
  await req('/properties/'+child.id,'GET',undefined,undefined,404);
  await req('/properties/'+grandchild.id,'GET',undefined,undefined,404);
  await req(`/properties/${parent.id}/children`,'GET',undefined,undefined,404);
  await req('/admin/properties/'+parent.id,'PATCH',{approval_status:'approved'},token);
  // Race: two allocations cannot both consume the same remaining capacity.
  parent=await req('/admin/properties/'+parent.id,'GET',undefined,token);
  const raced=await Promise.all([1,2].map(n=>fetch(`${base}/admin/properties/${parent.id}/children`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({_version:parent._version,code:'RACE-SUB-'+n,title:'Lô đồng thời',area_m2:'400',price_total:'1'})})));
  assert.deepEqual(raced.map(r=>r.status).sort(),[201,409]);
  assert.equal((await req(`/admin/properties/${parent.id}/aggregate`,'GET',undefined,token)).subdivision.remaining_area_m2,'100.000000');
  // DB guard remains effective outside HTTP validation; rollback leaves totals intact.
  await assert.rejects(db.pool.query('UPDATE xland.properties SET area_m2=901 WHERE id=$1',[child.id]),/diện tích/);
  const publicRows=await db.transaction('xland_api',null,c=>c.query('SELECT id FROM xland.properties WHERE parent_property_id=$1',[parent.id]));
  assert.equal(publicRows.rowCount,5,'Unapproved sixth child remains private');
  const aggregate=await req(`/admin/properties/${child.id}/aggregate`,'GET',undefined,token);
  const parentAggregate=await req(`/admin/properties/${parent.id}/aggregate`,'GET',undefined,token);
  assert.equal(aggregate.media.length,parentAggregate.media.length);
  assert.equal(aggregate.documents.length,parentAggregate.documents.length);
  assert.ok(aggregate.media.length>0);assert.ok(aggregate.documents.length>0);assert.ok(aggregate.legal_items.length>0);
  assert.ok(aggregate.legal_items.every(i=>i.status==='pending'&&i.checked_date===null));
  return {parentId:parent.id,childId:child.id,grandchildId:grandchild.id};
}
