import assert from 'node:assert/strict';

export async function testPropertyForm({req,db,token,source}){
  const locations=await req('/admin/locations','GET',undefined,token);
  const current=locations.filter(l=>l.current),provinces=current.filter(l=>l.kind==='province'),communes=current.filter(l=>l.kind==='commune');
  assert.equal(provinces.length,34);assert.equal(communes.length,3321);
  const quangNinh=provinces.find(l=>l.code==='22');assert.ok(quangNinh);
  const ward=communes.find(l=>l.parent_code==='22'&&l.name==='Phường Hạ Long');assert.ok(ward);
  const special=communes.find(l=>l.parent_code==='22'&&l.name==='Đặc khu Vân Đồn');assert.ok(special);
  const draft={code:'FORM-QN',title:'Khu đất Quảng Ninh',province_code:'22',commune_code:ward.code,catalog_version:ward.catalog_version,category:'industrial',area_m2:'1000',price_total:'9007199254740993',has_subplots:true,status:'paused',approval_status:'pending',status_badge:'standard',consultant_id:source.consultant_id,address_detail:'  Khu phố 1  ',old_address:'  Phường Bạch Đằng, thành phố Hạ Long, tỉnh Quảng Ninh  '};
  await req('/admin/properties','POST',{...draft,commune_code:null},token,400);
  await req('/admin/properties','POST',{...draft,province_code:'01'},token,400);
  await req('/admin/properties','POST',{...draft,land_type:'residential'},token,400);
  let parent=await req('/admin/properties','POST',draft,token,201);
  assert.equal(parent.land_type,'other');assert.equal(parent.category,'industrial');assert.equal(parent.region,'north');assert.equal(parent.has_subplots,true);
  assert.equal(parent.province,quangNinh.name);assert.equal(parent.commune_name,ward.name);assert.equal(parent.district_code,null);assert.equal(parent.district,null);
  assert.equal(parent.old_address,draft.old_address.trim());assert.equal(parent.address_detail,'Khu phố 1');
  await req('/properties/'+parent.id,'GET',undefined,undefined,404);
  await req('/admin/properties/'+parent.id,'PATCH',{old_address:'x'.repeat(1001)},token,400);
  parent=await req('/admin/properties/'+parent.id,'PATCH',{_version:parent._version,commune_code:special.code,approval_status:'approved',status:'listed'},token);
  const visible=await req('/properties/'+parent.id);
  assert.equal(visible.communeName,'Đặc khu Vân Đồn');assert.equal(visible.oldAddress,draft.old_address.trim());assert.equal(visible.addressDetail,'Khu phố 1');
  assert.equal(visible.category,'industrial');assert.equal(visible.landType,'other','v1 enum compatibility');assert.equal(visible.districtName,'');
  const child=await req(`/admin/properties/${parent.id}/children`,'POST',{_version:parent._version,code:'FORM-QN-1',title:'Lô 1 Quảng Ninh',area_m2:'100',price_total:'1200000000'},token,201);
  assert.equal(child.old_address,parent.old_address);assert.equal(child.commune_code,special.code);assert.equal(child.land_type,'other');
  const count=await req('/properties/count?provinceCode=22&communeCode='+special.code+'&category=industrial');assert.equal(count.total,1);
  await req('/properties/count?provinceCode=01&communeCode='+special.code,'GET',undefined,undefined,400);
  parent=await req('/admin/properties/'+parent.id,'PATCH',{old_address:'  ',land_type:'residential'},token);
  assert.equal(parent.old_address,null);assert.equal(parent.category,'residential');
  const direct=await db.pool.connect();
  try{await direct.query('BEGIN');await assert.rejects(direct.query('UPDATE xland.properties SET land_type=$1,category=$2 WHERE id=$3',['agricultural','other',parent.id]),e=>e.code==='23514');await direct.query('ROLLBACK');}finally{direct.release();}
  const old=await req('/admin/properties/'+source.id,'PATCH',{has_subplots:true},token);assert.equal(old.catalog_version,source.catalog_version);
  assert.equal(await db.ready(),true);
}
