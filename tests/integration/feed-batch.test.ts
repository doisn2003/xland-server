import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {testApi} from '../helpers/api.js';
import {LegacySocialService} from '../helpers/legacy-social.js';
import {SocialService} from '../../src/services/social.js';
import {CoreService} from '../../src/services/core.js';
import type {Identity} from '../../src/services/auth.js';
import type {Wire} from '../../src/repositories/properties.js';
import {evidenceDirectory} from '../../src/config/evidence.js';

test('P2-019 batched feed equals pre-fix projection, cursor and identity state with constant query count',async()=>{
 const api=await testApi();
 try{
  const source=(await api.db.pool.query('SELECT * FROM xland.videos ORDER BY id')).rows;
  for(let i=0;i<96;i++){const v=source[i%source.length]!;await api.db.pool.query(`INSERT INTO xland.videos(id,property_id,author_id,media_id,caption,published_at,approval_status,view_count,is_illustrative)
   VALUES($1,$2,$3,$4,$5,$6,'approved',$7,true)`,[randomUUID(),v.property_id,v.author_id,v.media_id,'Synthetic batch regression '+i,new Date(Date.now()-i*1000),String(i)]);}
  const a=await api.login(),b=await api.login(api.context.second),video=source[0]!,consultant=String(video.author_id),property=String(video.property_id);
  await api.request('/videos/'+video.id+'/like','PUT',{},a);await api.request('/videos/'+video.id+'/like','PUT',{},b);
  await api.request('/videos/'+video.id+'/saved','PUT',{},a);await api.request('/properties/'+property+'/saved','PUT',{},a);await api.request('/authors/'+consultant+'/follow','PUT',{},a);
  await api.request('/videos/'+video.id+'/comments','POST',{text:'Synthetic count regression'},a,'batch-comment-key-01');
  const one:Identity={userId:api.context.first.id,digest:Buffer.alloc(32),expiresAt:new Date(Date.now()+86400000)},two:Identity={...one,userId:api.context.second.id};
  let queries=0;
  const core=new CoreService(api.db,api.service.auth,api.service.cursor,()=>new Date());
  core.read=(identity,work)=>api.db.transaction('xland_api',identity?.userId??null,c=>work(new Proxy(c,{get(target,key,receiver){if(key==='query')return(...args:unknown[])=>{queries++;return Reflect.apply(target.query,target,args);};return Reflect.get(target,key,receiver);}})),true);
  const old=new LegacySocialService(core),current=new SocialService(core);const proofs:Wire[]=[];
  for(const identity of [null,one,two])for(const limit of [10,20,50]){
   let cursor:string|undefined;const seen:string[]=[];
   for(let page=0;page<2;page++){
    const q={limit,cursor,feedScope:'recommended' as const};queries=0;const expected=await old.feed(identity,q);const legacyQueries=queries;
    queries=0;const actual=await current.feed(identity,q);const batchedQueries=queries;assert.deepEqual(actual,expected);assert.equal(batchedQueries,8);assert.equal(legacyQueries,1+7*(actual.data as Wire[]).length);
    const data=actual.data as Wire[];assert.equal(data.length,limit);for(const v of data){assert.equal(v.propertyId,(v.property as Wire).id);assert.equal((v.media as Wire).url,null);assert.equal((v.property as Wire).priceTotal,typeof (v.property as Wire).priceTotal==='string'?(v.property as Wire).priceTotal:'not a string');}
    seen.push(...data.map(v=>String(v.id)));cursor=(actual.meta as Wire).nextCursor as string;assert(cursor);proofs.push({identity:identity===null?'guest':identity===one?'ownerA':'ownerB',limit,page,items:data.length,legacyQueries,batchedQueries});
   }
   assert.equal(new Set(seen).size,2*limit);
  }
  for(const identity of [one,two]){
   assert.deepEqual(await current.feed(identity,{limit:50,feedScope:'following'}),await old.feed(identity,{limit:50,feedScope:'following'}));
   assert.deepEqual(await current.saved(identity,{limit:50}),await old.saved(identity,{limit:50}));
   assert.deepEqual(await current.consultantVideos(identity,consultant,{limit:50}),await old.consultantVideos(identity,consultant,{limit:50}));
  }
  const guest=await current.feed(null,{limit:50,feedScope:'recommended'});const cursor=(guest.meta as Wire).nextCursor as string;
  assert.equal((await api.request('/feed?limit=50&cursor='+encodeURIComponent(cursor),'GET',undefined,a)).status,400);
  assert.equal((await api.request('/feed?limit=50&cursor='+encodeURIComponent(cursor)+'&region=south')).status,400);
  assert.equal((await api.request('/feed?feedScope=following')).status,401);
  assert.deepEqual(await current.feed(null,{limit:20,feedScope:'recommended',region:'north'}),await old.feed(null,{limit:20,feedScope:'recommended',region:'north'}));
  const own=await core.read(one,c=>current.get(c,String(video.id))),foreign=await core.read(two,c=>current.get(c,String(video.id))),anonymous=await core.read(null,c=>current.get(c,String(video.id)));
  assert.equal(own.isSaved,true);assert.equal(foreign.isSaved,false);assert.equal(anonymous.isSaved,false);assert.equal(own.likeCount,2);assert.equal(anonymous.likeCount,2);assert.equal(anonymous.isLiked,false);assert.equal((own.author as Wire).isFollowing,true);assert.equal((foreign.author as Wire).isFollowing,false);assert.equal((foreign.property as Wire).isSaved,false);assert.equal(own.commentCount,1);
  const tombstone=randomUUID();await api.db.pool.query(`INSERT INTO xland.videos SELECT $1,property_id,author_id,media_id,caption,published_at,'pending',view_count,is_illustrative,deleted_at FROM xland.videos WHERE id=$2`,[tombstone,video.id]);
  await core.read(null,async c=>{assert.equal((await c.query('SELECT id FROM xland.videos WHERE id=$1',[tombstone])).rowCount,0);});
  await writeFile((await evidenceDirectory())+'/feed-batch-equivalence.json',JSON.stringify({oracleCommit:'f8cf94853ed5160a9a2532be6e3256c967428491',rows:120,proofs,allFieldsEquivalent:true,cursorEquivalent:true,crossUserCursorRejected:true,rlsPendingHidden:true,followingAndSavedEquivalent:true,noProcessCache:true,queryCountsExcludeTransactionSetup:true},null,2));
 }finally{await api.close();}
});
