import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyUploadBytes} from '../../src/admin/storage.js';
import {canonicalStorageKey} from '../../src/admin/uploads.js';
import {DomainError} from '../../src/domain/errors.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=','base64');
const invalid=(e:unknown)=>e instanceof DomainError&&e.status===400;
test('QA-05 validates real bytes, size and MIME instead of upload declarations',async()=>{
  await verifyUploadBytes(png,'image/png',png.length,'image/png');
  const fake=Buffer.from('plain text pretending to be an image');
  await assert.rejects(verifyUploadBytes(fake,'image/png',fake.length,'image/png'),invalid);
  await assert.rejects(verifyUploadBytes(Buffer.alloc(0),'image/png',1,'image/png'),invalid);
  await assert.rejects(verifyUploadBytes(png,'image/png',png.length,'video/mp4'),invalid);
  await assert.rejects(verifyUploadBytes(png,'image/png',png.length+1,'image/png'),invalid);
  await assert.rejects(verifyUploadBytes(png,'video/mp4',png.length,'video/mp4'),invalid);
});
test('S-03 storage keys reject traversal, encoding and ambiguous separators',()=>{
  for(const key of ['xland-admin-documents/a/../b.pdf','xland-admin-documents/a/%2e%2e/b.pdf','xland-admin-documents//x.pdf','xland-admin-documents/a\\x.pdf','xland-admin-documents/a/x.pdf?token=x'])assert.equal(canonicalStorageKey(key),false,key);
  assert.equal(canonicalStorageKey('xland-admin-documents/abc/file.pdf'),true);
});
