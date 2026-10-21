// Read-only rollout acceptance: a missing backend endpoint must fail this check.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const origin=process.env.XLAND_AUTHOR_ORIGIN??'https://xland-server-production.up.railway.app';
const target=new URL(origin);
assert.equal(target.origin,origin);
assert.equal(target.protocol,'https:');
const evidence=resolve(process.env.XLAND_AUTHOR_EVIDENCE??'.local/release/author-profiles-acceptance');
await mkdir(evidence,{recursive:true});
const report={checkedAt:new Date().toISOString(),origin,status:'pending',databaseWrites:0,authors:[]};
async function get(path){
  const response=await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,`${path}: expected HTTP 200, received ${response.status}`);
  return response.json();
}
try {
  assert.equal((await get('/health/ready')).data.status,'ready');
  const feed=await get('/api/v1/feed?limit=50');
  assert.ok(feed.data.length,'Public feed must contain a video for acceptance');
  const authors=new Map(feed.data.map(video=>[video.author.id,video.author]));
  for(const [id,expected] of authors){
    const profile=(await get(`/api/v1/authors/${id}`)).data;
    assert.equal(profile.id,id);
    assert.equal(profile.displayName,expected.displayName);
    assert.ok(profile.consultantId===null||profile.consultantId===id,'Consultant identity must belong to the author');
    assert.ok(Number.isInteger(profile.videoCount)&&profile.videoCount>=0);
    assert.ok(Number.isInteger(profile.followerCount)&&profile.followerCount>=0);
    assert.equal(profile.isFollowing,false,'Guest follow state must be false');
    assert.deepEqual(Object.keys(profile).sort(),['id','displayName','role','avatarUrl','isVerified','isFollowing','videoCount','followerCount','consultantId','isIllustrative'].sort());
    const first=await get(`/api/v1/authors/${id}/videos?limit=2`);
    assert.ok(first.data.length,'A feed author must have a public video');
    for(const video of first.data)assert.equal(video.author.id,id);
    if(first.meta.hasMore){
      assert.ok(first.meta.nextCursor);
      const second=await get(`/api/v1/authors/${id}/videos?limit=2&cursor=${encodeURIComponent(first.meta.nextCursor)}`);
      for(const video of second.data){
        assert.equal(video.author.id,id);
        assert.ok(!first.data.some(previous=>previous.id===video.id),'Cursor must not repeat videos');
      }
    }
    report.authors.push({id,name:profile.displayName,consultantId:profile.consultantId,videoCount:profile.videoCount,directEndpoints:'pass'});
  }
  report.status='pass';
}catch(error){
  report.status='failed';
  report.failure=error instanceof assert.AssertionError?error.message:'Public API request failed';
  process.exitCode=1;
}
await writeFile(join(evidence,'author-profiles.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
