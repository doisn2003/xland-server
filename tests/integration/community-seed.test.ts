import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApi } from '../helpers/api.js';
import { seedCommunity } from '../../scripts/seed-community.js';
import { communityClub, communityEvents } from '../../scripts/community-catalog.js';
import type { Wire } from '../../src/repositories/properties.js';

test('community catalog persists once, preserves edits and is readable through public paginated APIs', async () => {
  const api = await testApi();
  try {
    const first = await seedCommunity(api.db.pool);
    assert.equal(first.insertedClubs, 1);
    assert.equal(first.insertedEvents, 6);
    assert.equal(communityEvents.filter(e => e.tags[0] !== 'Bất động sản').length, 2);
    const second = await seedCommunity(api.db.pool);
    assert.equal(second.insertedClubs, 0);
    assert.equal(second.insertedEvents, 0);
    const club = await api.request('/clubs/' + communityClub.id);
    assert.equal(club.status, 200);
    assert.equal((club.body.data as Wire).title, communityClub.title);
    for (const event of communityEvents) {
      const detail = await api.request('/events/' + event.id);
      assert.equal(detail.status, 200);
      const data = detail.body.data as Wire;
      assert.equal(data.title, event.title);
      assert.equal(data.ticketPriceVnd, event.ticketPriceVnd);
      assert.equal(data.timeZone, 'Asia/Ho_Chi_Minh');
      assert.equal((data.media as unknown[]).length, 1);
      assert.deepEqual(Object.keys((data.media as Wire[])[0]!).sort(),
        ['altText','durationSeconds','id','isIllustrative','kind','thumbnailUrl','url'].sort());
      assert.equal((data.media as Wire[])[0]!.durationSeconds, null);
      assert.equal((data.agenda as unknown[]).length, 3);
    }
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = await api.request('/events?limit=4' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      assert.equal(response.status, 200);
      for (const row of response.body.data as Wire[]) {
        assert.ok(!seen.has(String(row.id)));
        seen.add(String(row.id));
      }
      cursor = (response.body.meta as {nextCursor?:string}).nextCursor;
    } while (cursor);
    assert.ok(communityEvents.every(e => seen.has(e.id)));
    await api.db.pool.query('UPDATE xland.events SET title=$2 WHERE id=$1', [communityEvents[0]!.id,'Tên đã biên tập']);
    await seedCommunity(api.db.pool);
    assert.equal(((await api.request('/events/' + communityEvents[0]!.id)).body.data as Wire).title, 'Tên đã biên tập');
  } finally { await api.close(); }
});
