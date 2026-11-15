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

/*
 * Every test here reads the committed snapshot and then judges it at a date
 * derived from its own generatedAt, rather than at today's date. That is not
 * fussiness: two of these used to assert the shipped file was fresh right now,
 * which is true only for as long as somebody rebuilt it recently. They passed
 * all through September and failed in November with no code change, exactly as
 * refresh.test.js did before it. A test that fails on the calendar gets
 * explained away once and ignored after that.
 *
 * Whether the shipped snapshot is actually current is a real question, and it
 * has its own answer: `npm run check:freshness`, which reports it without
 * pretending to be a verdict on the code.
 */

test('a freshly built snapshot is fresh on both clocks', async () => {
  const { snapshot } = await getFreshness();
  // One day after it was built, whenever that was.
  const f = await getFreshness(daysAfter(snapshot.generatedAt, 1));
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
  const { snapshot } = await getFreshness();
  const f = await getFreshness(daysAfter(snapshot.generatedAt, 1));
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

/*
 * The advice has to be runnable, not just present.
 *
 * It used to say "Rebuild the snapshot with: npm run build:data" in every
 * state, including the two where that command cannot do anything. It is read
 * by the CLI and printed in the app's own staleness banner, so a reader with a
 * synthetic provider configured was told to run something the ingest refuses
 * outright, with no hint why. An instruction that fails costs whoever follows
 * it a round of debugging before they learn what this module already knew.
 */
test('with a generated-price provider, the advice says the rebuild will refuse', async () => {
  const { getProvider } = await import('../src/services/priceProviders/index.js');
  const demo = getProvider('demo');
  assert.equal(demo.synthetic, true, 'this test is meaningless if demo is not synthetic');

  // Injected rather than set through PRICE_PROVIDER: config reads that once at
  // import, so assigning the variable here would change nothing and this test
  // would pass against the default provider while asserting nothing.
  const { snapshot } = await getFreshness();
  const f = await getFreshness(daysAfter(snapshot.generatedAt, SNAPSHOT_STALE_DAYS + 1), {
    provider: () => demo,
  });
  assert.match(f.action, /build:data/, 'it should still name the command');
  assert.match(f.action, /generates prices/, 'and say why it will not work');
});

test('with a real provider, the advice says what the rebuild needs', async () => {
  // Not a prediction that it will fail: whether a provider can serve a decade
  // of daily prices is something only the attempt settles. What it must not do
  // is imply that today's price is enough, which is the misunderstanding that
  // sends someone to configure a spot-only provider and wonder why the ingest
  // exits 3.
  const { snapshot } = await getFreshness();
  const f = await getFreshness(daysAfter(snapshot.generatedAt, SNAPSHOT_STALE_DAYS + 1));
  assert.match(f.action, /build:data/);
  assert.match(f.action, /whole history/);
  assert.doesNotMatch(f.action, /generates prices/);
});
