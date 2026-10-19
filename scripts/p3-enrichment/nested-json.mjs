const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.trim().length>0;
const exactKeys=(v,keys)=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function propertyHighlights(p) {
  return [
    {title:'Khu vực tham khảo',description:String(p.district)},
    {title:'Kích thước tham khảo',description:`${p.frontage_m} × ${p.depth_m} m`},
    {title:'Thông tin và lịch xem',description:'Liên hệ tư vấn để kiểm tra thông tin và lịch xem'}
  ];
}
export function validateC4NestedJson(dataset,{allowLegacyHighlights=false}={}) {
  const url=v=>v===null||(exactKeys(v,['$asset'])&&text(v.$asset))||(typeof v==='string'&&v.startsWith('https://'));
  const media=v=>exactKeys(v,['id','kind','url','thumbnailUrl','durationSeconds','altText','isIllustrative'])&&text(v.id)&&
    ['image','video'].includes(v.kind)&&url(v.url)&&url(v.thumbnailUrl)&&text(v.altText)&&typeof v.isIllustrative==='boolean'&&
    (v.durationSeconds===null||(Number.isSafeInteger(v.durationSeconds)&&v.durationSeconds>=0));
  for(const row of dataset.rows) {
    if(row.table==='properties') {
      const h=row.values.highlights;
      const valid=Array.isArray(h)&&h.every(v=>exactKeys(v,['title','description'])&&text(v.title)&&text(v.description));
      const legacy=allowLegacyHighlights&&Array.isArray(h)&&h.every(text);
      if(!valid&&!legacy)throw new Error('C4 Highlight requires {title, description}; string[] is invalid');
    }
  }
  for(const row of [...dataset.rows,...dataset.adopted]) {
    if(['events','clubs'].includes(row.table)&&'media' in row.values) {
      if(!Array.isArray(row.values.media)||!row.values.media.every(media))throw new Error('C4 nested MediaAsset mismatch');
    }
  }
  return true;
}
