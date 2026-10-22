import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

test('pinned QA fixtures retain source checksums; optional live Dart checkout matches',async()=>{
  const manifest=JSON.parse(await readFile('tests/fixtures/manifest.json','utf8')) as {files:{path:string;sha256:string}[]};
  for(const file of manifest.files){
    const bytes=await readFile(file.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
    if(process.env.XLAND_MOBILE_ROOT&&file.path.startsWith('tests/fixtures/mobile/')){
      const live=await readFile(resolve(process.env.XLAND_MOBILE_ROOT,file.path.replace('tests/fixtures/mobile/','')));
      assert.equal(createHash('sha256').update(live).digest('hex'),file.sha256,'Live Dart drift: '+file.path);
    }
  }
});
