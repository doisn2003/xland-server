// Used only by the isolated local website acceptance harness.
import {AdminService} from '../src/admin/service.ts';
export async function seedSubplotsQa(db,userId) {
  const service=new AdminService(db),identity={userId,roles:['admin']};
  const source=(await db.pool.query('SELECT * FROM xland.properties ORDER BY id LIMIT 1')).rows[0];
  const fields=(await service.schema()).properties.fields;
  const values=Object.fromEntries(fields.filter(f=>!f.readonly).map(f=>[f.name,source[f.name]]));
  const ward=(await db.pool.query("SELECT * FROM xland.geo_locations WHERE kind='commune' AND parent_code='22' AND name='Phường Hạ Long'")).rows[0];
  let parent=await service.save(identity,'properties',{...values,code:'QA-GARDEN',title:'Khu đất Quảng Ninh · 1.000 m²',province_code:'22',commune_code:ward.code,catalog_version:ward.catalog_version,commune_name:ward.name,district_code:null,district:null,category:'industrial',land_type:'other',address_detail:'Khu phố 1',old_address:'Phường Bạch Đằng, thành phố Hạ Long, tỉnh Quảng Ninh',area_m2:'1000',has_subplots:true,approval_status:'approved',status:'listed'});
  const children=[];
  for(let i=1;i<=5;i++){
    parent=await service.get(identity,'properties',parent.id);
    const child=await service.createChild(identity,parent.id,{_version:parent._version,code:`QA-LOT-${i}`,title:`Lô ${i} · Khu vườn Hòa Lạc`,area_m2:String(100+i*10),price_total:String(1200000000+i*200000000),frontage_m:String(5+i),is_corner:i===1});
    children.push(await service.save(identity,'properties',{approval_status:'approved',status:i===5?'sold':'listed',has_subplots:i===1},child.id));
  }
  const child=await service.get(identity,'properties',children[0].id);
  const nested=await service.createChild(identity,child.id,{_version:child._version,code:'QA-LOT-1A',title:'Lô 1A · Vườn nhỏ',area_m2:'50',price_total:'650000000'});
  await service.save(identity,'properties',{approval_status:'approved',status:'listed'},nested.id);
  return {parentId:parent.id,childId:children[0].id,nestedId:nested.id};
}
