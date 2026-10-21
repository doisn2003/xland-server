import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testApi} from '../helpers/api.js';
import type {Wire} from '../../src/repositories/properties.js';

test('public author profiles separate video posters from assigned consultants',async()=>{
  const api=await testApi();
  try {
    const authorId=api.context.second.id;
    const source=(await api.db.pool.query('SELECT * FROM xland.videos ORDER BY id LIMIT 1')).rows[0];
    await api.db.pool.query("UPDATE xland.user_profiles SET display_name='Ngọc Anh' WHERE id=$1",[authorId]);
    const ids=Array.from({length:4},()=>randomUUID());
    for(let i=0;i<ids.length;i++)await api.db.pool.query(`INSERT INTO xland.videos
      (id,property_id,author_id,media_id,caption,published_at,approval_status,view_count,is_illustrative,deleted_at)
      VALUES($1,$2,$3,$4,'Video của Ngọc Anh',$5,$6,0,true,$7)`,[
      ids[i],source.property_id,authorId,source.media_id,new Date(Date.now()-i*1000),
      i===2?'pending':'approved',i===3?new Date():null,
    ]);
    const response=await api.request('/authors/'+authorId);
    assert.equal(response.status,200);
    const profile=response.body.data as Wire;
    assert.equal(profile.id,authorId);
    assert.equal(profile.displayName,'Ngọc Anh');
    assert.equal(profile.consultantId,null);
    assert.equal(profile.videoCount,2);
    assert.equal(profile.followerCount,0);
    assert.equal(profile.isFollowing,false);
    assert.deepEqual(Object.keys(profile).sort(),['id','displayName','role','avatarUrl','isVerified','isFollowing','videoCount','followerCount','consultantId','isIllustrative'].sort());

    const first=await api.request(`/authors/${authorId}/videos?limit=1`);
    assert.equal(first.status,200,JSON.stringify(first.body.error));
    const video=(first.body.data as Wire[])[0]!;
    assert.equal(video.id,ids[0]);
    assert.equal((video.author as Wire).id,authorId);
    const consultantId=(video.property as Wire).consultantId;
    assert.notEqual(consultantId,authorId);
    const cursor=String((first.body.meta as Wire).nextCursor);
    assert.equal((first.body.meta as Wire).hasMore,true);
    const second=await api.request(`/authors/${authorId}/videos?limit=1&cursor=${encodeURIComponent(cursor)}`);
    assert.equal(second.status,200);
    assert.deepEqual((second.body.data as Wire[]).map(v=>v.id),[ids[1]]);
    assert.equal((second.body.meta as Wire).hasMore,false);
    assert.equal((await api.request(`/authors/${consultantId}/videos?cursor=${encodeURIComponent(cursor)}`)).status,400);
    const consultant=await api.request('/authors/'+consultantId);
    assert.equal(consultant.status,200);
    assert.equal((consultant.body.data as Wire).consultantId,consultantId);
    assert.equal((await api.request('/consultants/'+authorId)).status,404);

    const owner=await api.login();
    assert.equal((await api.request(`/authors/${authorId}/videos?limit=1&cursor=${encodeURIComponent(cursor)}`,'GET',undefined,owner)).status,400);
    await api.request('/authors/'+authorId+'/follow','PUT',{},owner);
    const followed=(await api.request('/authors/'+authorId,'GET',undefined,owner)).body.data as Wire;
    assert.equal(followed.isFollowing,true);
    assert.equal(followed.followerCount,1);
    const guest=(await api.request('/authors/'+authorId)).body.data as Wire;
    assert.equal(guest.isFollowing,false);
    assert.equal(guest.followerCount,1);
    assert.equal((await api.request('/authors/'+randomUUID())).status,404);
    assert.equal((await api.request('/authors/'+randomUUID()+'/videos')).status,404);
    assert.equal((await api.request('/authors/not-a-uuid')).status,400);
    assert.equal((await api.request('/authors/'+authorId+'?includeContacts=true')).status,400);
    assert.equal((await api.request('/authors/'+authorId+'/videos?authorId='+consultantId)).status,400);
  } finally { await api.close(); }
});
