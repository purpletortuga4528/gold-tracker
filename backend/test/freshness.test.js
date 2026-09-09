import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFreshness,
  SNAPSHOT_WARN_DAYS,
  SNAPSHOT_STALE_DAYS,
  DATA_WARN_DAYS,
} from '../src/services/freshness.js';

const DAY = 24 * 60 * 60 * 1000;
const daysAfter = (iso, n) => new Date(new Date(iso).getTime() + n * DAY);

test('the shipped snapshot is currently fresh', async () => {
  const f = await getFreshness();
  assert.equal(f.overall, 'fresh');
  assert.equal(f.action, null);
});

test('an ageing snapshot is flagged before it is stale', async () => {
  const { snapshot } = await getFreshness();
  const f = await getFreshness(daysAfter(snapshot.generatedAt, SNAPSHOT_WARN_DAYS + 1));
  assert.equal(f.snapshot.status, 'ageing');
  assert.match(f.action, /build:data/);
});

test('a long-abandoned snapshot reports stale', async () => {
  const { snapshot } = await getFreshness();
  const f = await getFreshness(daysAfter(snapshot.generatedAt, SNAPSHOT_STALE_DAYS + 1));
  assert.equal(f.snapshot.status, 'stale');
  assert.equal(f.overall, 'stale');
});

test('snapshot age and data age are graded on separate clocks', async () => {
  // The point of splitting them: IRFCL reports month-end with a lag, so a
  // freshly built snapshot always contains figures that are weeks old. If both
  // were judged on one threshold, either a healthy snapshot would look stale or
  // a genuinely abandoned one would look fine.
  const f = await getFreshness();
  assert.ok(f.data.ageDays > f.snapshot.ageDays, 'IMF figures should lag the build');
  assert.ok(DATA_WARN_DAYS > SNAPSHOT_WARN_DAYS, 'data is allowed to be older than the build');
  assert.equal(f.snapshot.status, 'fresh');
  assert.equal(f.data.status, 'fresh');
});

test('the worst of the two clocks decides the overall grade', async () => {
  const { snapshot } = await getFreshness();
  const f = await getFreshness(daysAfter(snapshot.generatedAt, SNAPSHOT_STALE_DAYS + 1));
  assert.equal(f.overall, 'stale', 'a stale snapshot must not be masked by fresh-looking data');
});
