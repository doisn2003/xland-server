import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertWire} from '../helpers/wire.js';
test('wire oracle matches mobile optional narrative fields without relaxing required fields',()=>{
  assertWire({startsAt:'2026-10-22T00:00:00Z',title:'Lịch trình'},'AgendaItem');
  assertWire({name:'Tư vấn',role:'Chuyên viên',avatarUrl:null,description:null},'Speaker');
  assert.throws(()=>assertWire({startsAt:'2026-10-22T00:00:00Z'},'AgendaItem'));
  assert.throws(()=>assertWire({startsAt:'2026-10-22T00:00:00Z',title:'Lịch trình',description:42},'AgendaItem'));
});
