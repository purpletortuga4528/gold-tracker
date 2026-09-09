import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listReserves, getReserve, getReservesMeta } from '../src/services/reserves.js';

test('the dataset loads and is sorted by tonnes', async () => {
  const { countries, total } = await listReserves();
  assert.ok(total > 50, `expected a meaningful number of reporters, got ${total}`);
  for (let i = 1; i < countries.length; i += 1) {
    assert.ok(
      countries[i - 1].reserveTonnes >= countries[i].reserveTonnes,
      `row ${i} breaks the descending sort`,
    );
  }
});

test('the largest holder is the United States and the figure is the published one', async () => {
  const { countries } = await listReserves();
  assert.equal(countries[0].countryCode, 'USA');
  assert.ok(
    Math.abs(countries[0].reserveTonnes - 8133.5) < 1,
    `USA tonnage drifted: ${countries[0].reserveTonnes}`,
  );
});

test('no country exceeds the plausibility ceiling', async () => {
  const { countries } = await listReserves({ kind: 'country' });
  for (const c of countries) {
    assert.ok(c.reserveTonnes <= 9000, `${c.countryCode} at ${c.reserveTonnes} t is not plausible`);
  }
});

test('aggregates and institutions are excluded from the country list by default', async () => {
  const { countries } = await listReserves();
  assert.ok(countries.every((c) => c.kind === 'country'));
  const all = await listReserves({ kind: 'all' });
  assert.ok(all.countries.some((c) => c.kind !== 'country'));
});

test('list rows omit history but the detail route includes it', async () => {
  const { countries } = await listReserves({ limit: 1 });
  assert.equal(countries[0].history, undefined);
  const detail = await getReserve('usa');
  assert.ok(Array.isArray(detail.country.history) && detail.country.history.length > 12);
});

test('search matches name, code and region', async () => {
  assert.ok((await listReserves({ search: 'switz' })).countries.length >= 1);
  assert.ok((await listReserves({ search: 'CHE' })).countries.length >= 1);
  assert.ok((await listReserves({ region: 'Europe' })).countries.length > 5);
});

test('an unknown code returns null rather than throwing', async () => {
  assert.equal(await getReserve('ZZZ'), null);
});

test('meta carries provenance and the region list', async () => {
  const meta = await getReservesMeta();
  assert.match(meta.source, /International Monetary Fund/);
  assert.ok(meta.sourceUrl.startsWith('https://'));
  assert.ok(meta.regions.includes('Europe'));
  assert.ok(meta.latestAsOfDate >= '2026-01-31');
});
