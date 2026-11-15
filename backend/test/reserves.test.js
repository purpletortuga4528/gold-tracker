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

test('a name spelled with a diacritic is findable without typing it', async () => {
  /*
   * The IMF spells one reporter "Türkiye, Republic of". Plain lowercasing meant
   * searching "Turkiye" returned nothing: the row was reachable only by typing
   * the umlaut or by its ISO code, and it is a top ten holder and about the
   * most likely name anyone would type.
   *
   * Written against whatever the dataset actually holds rather than against
   * TUR by name, so this keeps testing the behaviour if the IMF respells that
   * reporter or accents another one.
   */
  const { countries } = await listReserves({ kind: 'all' });
  const accented = countries.filter((c) => /[^\x00-\x7F]/.test(c.countryName));
  assert.ok(accented.length > 0, 'the dataset should still contain an accented name to test with');

  for (const row of accented) {
    const asFiled = row.countryName.split(',')[0].trim();
    const asTyped = asFiled.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    assert.notEqual(asTyped, asFiled, `${row.countryCode} should differ once folded`);

    for (const query of [asFiled, asTyped, asTyped.toLowerCase(), asTyped.toUpperCase()]) {
      const hits = (await listReserves({ kind: 'all', search: query })).countries;
      assert.ok(
        hits.some((c) => c.countryCode === row.countryCode),
        `searching ${JSON.stringify(query)} should find ${row.countryCode}`,
      );
    }
  }
});

test('folding does not make the search match everything', async () => {
  // A fold that returned '' or swallowed the query would pass the test above
  // while making search useless, which is the failure worth guarding.
  const { total } = await listReserves({ kind: 'all' });
  assert.equal((await listReserves({ kind: 'all', search: 'zzzznotacountry' })).countries.length, 0);
  assert.ok((await listReserves({ kind: 'all', search: 'switzerland' })).countries.length < total);
  assert.equal((await listReserves({ kind: 'all', search: 'USA' })).countries.length, 1);
});
