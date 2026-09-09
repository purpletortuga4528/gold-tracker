#!/usr/bin/env node
/**
 * Checks that figures quoted in the documentation still match reality.
 *
 * This exists because the same failure kept happening: a number measured once,
 * written into prose, and then quietly falsified by a later change. The rate
 * limit egress figure said 200 MB after the limit had been doubled to 600. A
 * note said Switzerland sat 8 percent off the market price, measured before
 * detection was fixed to price each filing at its own month, after which it was
 * 0.1 percent. A comment said search responses were 29 kB each when the real
 * range was 3.5 to 20.7 kB. Prose does not fail a test suite, so it drifted.
 *
 * Everything here is derived from the config, the dataset or a live response.
 * Nothing is hardcoded twice: if a check needs a magic number, it is wrong.
 *
 * Usage:
 *   node scripts/check-docs.mjs            static checks only
 *   node scripts/check-docs.mjs --live     also measure a running API on :5174
 *   node scripts/check-docs.mjs --counts   also run both suites and check the
 *                                          test counts quoted in the README
 *
 * Exit codes: 0 all claims hold, 1 at least one is stale.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const results = [];
const ok = (what) => results.push({ pass: true, what });
const bad = (what, detail) => results.push({ pass: false, what, detail });

/** First capture group of `re` in `text`, or undefined. Accepts a non-global regex. */
function claims(text, re) {
  const m = re.exec(text);
  return m ? [m[1]] : [];
}

const readme = read('README.md');
const dataReadme = read('backend/data/README.md');
const envExample = read('backend/.env.example');
const dataset = JSON.parse(read('backend/data/gold-reserves.json'));
const { config } = await import(`file://${resolve(ROOT, 'backend/src/config.js')}`);

// --- Rate limits quoted in the README table must match the config -----------
for (const [label, actual, re] of [
  ['general', config.rateLimit.general, /general \(`\/api\/\*`\) \| (\d+)\/min/],
  ['price history', config.rateLimit.priceHistory, /`\/api\/price\/history` \| (\d+)\/min/],
  ['health', config.rateLimit.health, /`\/api\/health` \| (\d+)\/min/],
]) {
  const [quoted] = claims(readme, re);
  if (quoted === undefined) bad(`README quotes the ${label} limit`, 'no figure found in the table');
  else if (Number(quoted) !== actual) bad(`README ${label} limit`, `says ${quoted}, config is ${actual}`);
  else ok(`README ${label} limit (${actual}/min)`);
}

// --- .env.example must document the same defaults the config uses -----------
for (const [key, actual] of [
  ['RATE_LIMIT_GENERAL', config.rateLimit.general],
  ['RATE_LIMIT_PRICE_HISTORY', config.rateLimit.priceHistory],
  ['RATE_LIMIT_HEALTH', config.rateLimit.health],
  ['PORT', config.port],
  ['CACHE_SPOT_SECONDS', config.cache.spotSeconds],
  ['CACHE_HISTORY_SECONDS', config.cache.historySeconds],
]) {
  const m = new RegExp(`^${key}=(.*)$`, 'm').exec(envExample);
  if (!m) bad(`.env.example documents ${key}`, 'absent');
  else if (m[1].trim() !== String(actual)) bad(`.env.example ${key}`, `says ${m[1].trim()}, config is ${actual}`);
  else ok(`.env.example ${key} (${actual})`);
}

// --- Dataset counts quoted in prose ----------------------------------------
{
  const [quoted] = claims(readme, /\((\d+) countries, monthly figures back to/);
  if (Number(quoted) !== dataset.meta.countryCount) {
    bad('README country count', `says ${quoted}, dataset has ${dataset.meta.countryCount}`);
  } else ok(`README country count (${quoted})`);
}
{
  const usa = dataset.countries.find((c) => c.countryCode === 'USA');
  const quoted = /8,133\.5 t/.test(dataReadme);
  if (!quoted) bad('data/README quotes the US anchor', 'the 8,133.5 t figure is gone');
  else if (Math.abs(usa.reserveTonnes - 8133.5) > 0.1) {
    bad('data/README US anchor', `dataset now says ${usa.reserveTonnes}`);
  } else ok(`data/README US anchor (${usa.reserveTonnes} t)`);
}

// --- The plausibility ceiling quoted in prose ------------------------------
{
  const validation = JSON.parse(read('backend/data/validation.json'));
  const [quoted] = claims(dataReadme, /`maxPlausibleTonnes` \(([\d,]+) t/);
  const asNumber = Number(String(quoted).replace(/,/g, ''));
  if (asNumber !== validation.maxPlausibleTonnes) {
    bad('data/README ceiling', `says ${quoted}, validation.json is ${validation.maxPlausibleTonnes}`);
  } else ok(`data/README ceiling (${quoted} t)`);
}

// --- Corrections named in prose must be the ones actually applied ----------
{
  const applied = dataset.meta.scaleCorrections.map((c) => c.countryCode).sort();
  const named = /Currently corrected: \*\*(\w+)\*\* and \*\*(\w+)\*\*/.exec(dataReadme);
  const inProse = named ? [named[1], named[2]].sort() : [];
  if (inProse.join() !== applied.join()) {
    bad('data/README lists the corrections', `prose says ${inProse.join('+') || 'none'}, data has ${applied.join('+')}`);
  } else ok(`data/README corrections (${applied.join(', ')})`);
}

// --- The two US reserve shares quoted in data/README ------------------------
// The naive one is fixed by the dataset. The restated one moves with the gold
// price, so the prose quotes the price it was struck at and this recomputes it
// at exactly that price: a claim tied to a stated input is checkable, one that
// floats is not.
{
  const usa = dataset.countries.find((c) => c.countryCode === 'USA');
  const validation = JSON.parse(read('backend/data/validation.json'));
  const OUNCES_PER_TONNE = 1e6 / 31.1034768;
  const ounces = usa.reserveTonnes * OUNCES_PER_TONNE;
  const share = (perOunce) => {
    const gold = ounces * perOunce;
    return (100 * gold) / (gold + usa.nonGoldReservesUsd);
  };

  const naive = share(validation.statutoryBookUsdPerOunce);
  const [quotedNaive] = claims(dataReadme, /at ([\d.]+) percent of US reserves/);
  if (quotedNaive === undefined) bad('data/README quotes the naive US share', 'no figure found');
  else if (Math.abs(Number(quotedNaive) - naive) > 0.05) {
    bad('data/README naive US share', `says ${quotedNaive}%, recomputed ${naive.toFixed(2)}%`);
  } else ok(`data/README naive US share (${quotedNaive}%)`);

  const m = /gives ([\d.]+) percent at a gold price of \$([\d,]+) an ounce/.exec(dataReadme);
  if (!m) bad('data/README quotes the restated US share', 'no figure and price found');
  else {
    const restated = share(Number(m[2].replace(/,/g, '')));
    if (Math.abs(Number(m[1]) - restated) > 0.05) {
      bad('data/README restated US share', `says ${m[1]}% at $${m[2]}, recomputed ${restated.toFixed(2)}%`);
    } else ok(`data/README restated US share (${m[1]}% at $${m[2]})`);
  }
}

// --- The chart's range buttons must match the ranges the API accepts --------
// price.js says "the list lives in RANGE_MONTHS; do not restate it, it drifts",
// and PriceChart.jsx restates it, because the buttons render before any API
// response arrives. That is a reasonable trade and this is the check that makes
// it safe: a range in the UI that the API rejects is a 400 on a button click.
{
  const { SUPPORTED_RANGES } = await import(`file://${resolve(ROOT, 'backend/src/services/price.js')}`);
  const chart = read('frontend/src/components/PriceChart.jsx');
  const m = /const RANGES = \[([^\]]*)\]/.exec(chart);
  if (!m) bad('PriceChart lists its ranges', 'no RANGES array found');
  else {
    const inUi = m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
    if (inUi.join() !== SUPPORTED_RANGES.join()) {
      bad('chart ranges match the API', `UI has ${inUi.join('/')}, API accepts ${SUPPORTED_RANGES.join('/')}`);
    } else ok(`chart ranges match the API (${inUi.length}: ${inUi.join(', ')})`);
  }
}

// --- No em or en dashes in authored prose ----------------------------------
for (const [name, text] of [['README.md', readme], ['data/README.md', dataReadme]]) {
  // Escapes, not literals: this file would otherwise trip the very check it
  // performs, and a rule enforced by a file that breaks it is a bad rule.
  const n = (text.match(/[\u2013\u2014]/g) ?? []).length;
  if (n) bad(`${name} dash policy`, `${n} em/en dashes present`);
  else ok(`${name} dash policy`);
}

// --- Test counts quoted in the README, only when asked ---------------------
// Opt-in because it runs both suites, which takes about fifteen seconds. It
// earns that: the README said 50 backend tests when there were 71, which is
// exactly the kind of number that nobody re-checks after adding a test file.
if (process.argv.includes('--counts')) {
  // The runners are invoked directly rather than through npm. Going through npm
  // would need `shell: true` on Windows, because Node refuses to spawn a .cmd
  // without one and deprecates passing args with one, and a shell is not worth
  // it to read two numbers. These two commands are the `test` scripts in
  // backend/package.json and frontend/package.json; if either changes, this
  // reports that it could not read a total rather than reporting a wrong one.
  //
  // Colour is stripped before anything is parsed. Vitest emits SGR sequences
  // when it detects GitHub Actions, so escape codes land between "Tests" and
  // the number and a pattern written against the plain local output matches
  // nothing at all. That is exactly how this check first failed: green here,
  // "could not read a total" in CI.
  const stripAnsi = (t) => t.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const run = (cwd, args) => {
    try {
      return stripAnsi(execFileSync(process.execPath, args, { cwd: resolve(ROOT, cwd), encoding: 'utf8', stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 }));
    } catch (err) {
      // A failing suite still prints its totals, which is what we are reading.
      return stripAnsi(`${err.stdout ?? ''}${err.stderr ?? ''}`);
    }
  };
  const backendOut = run('backend', ['--test']);
  // With coverage, so one run answers both the count and the percentage the
  // README quotes. A floor in vite.config.js catches a regression; this catches
  // the prose drifting away from the number.
  const frontendOut = run('frontend', ['node_modules/vitest/vitest.mjs', 'run', '--coverage']);
  // Both reporter shapes: node:test prints "ℹ tests N" as spec and
  // "# tests N" as TAP, and which one you get depends on whether stdout is a
  // terminal.
  const backend = Number(/^(?:ℹ|#) tests (\d+)$/m.exec(backendOut)?.[1]);
  const frontend = Number(/Tests\s+(\d+) passed/.exec(frontendOut)?.[1]);

  if (!Number.isFinite(backend) || !Number.isFinite(frontend)) {
    // Which runner, and what it printed. "One of the runners" is not enough
    // to act on when the failure only reproduces in CI.
    const tail = (t) => t.trim().slice(-300);
    const which = !Number.isFinite(backend) ? `backend: ${tail(backendOut)}` : `frontend: ${tail(frontendOut)}`;
    bad('test counts', `could not read a total from the ${which}`);
  } else {
    let anyStale = false;
    for (const m of readme.matchAll(/(\d+) backend, (\d+) frontend/g)) {
      if (Number(m[1]) !== backend || Number(m[2]) !== frontend) {
        bad('README test counts', `says ${m[1]} backend and ${m[2]} frontend, ran ${backend} and ${frontend}`);
        anyStale = true;
      }
    }
    const [quotedTotal] = claims(readme, /(\d+) of them: \d+ backend/);
    if (quotedTotal !== undefined && Number(quotedTotal) !== backend + frontend) {
      bad('README test total', `says ${quotedTotal}, ran ${backend + frontend}`);
      anyStale = true;
    }
    if (!anyStale) ok(`README test counts (${backend} backend, ${frontend} frontend)`);
  }

  const measured = Number(/All files\s*\|\s*([\d.]+)/.exec(frontendOut)?.[1]);
  const [quotedCoverage] = claims(readme, /covers (\d+) percent of statements/);
  if (!Number.isFinite(measured)) bad('frontend coverage', 'no summary row in the vitest output');
  else if (quotedCoverage === undefined) bad('README quotes frontend coverage', 'no figure found');
  else if (Math.round(measured) !== Number(quotedCoverage)) {
    bad('README frontend coverage', `says ${quotedCoverage} percent, measured ${measured}`);
  } else ok(`README frontend coverage (${quotedCoverage} percent, measured ${measured})`);
}

// --- Live measurements, only when asked ------------------------------------
if (process.argv.includes('--live')) {
  const base = `http://127.0.0.1:${config.port}`;
  const size = async (path) => (await (await fetch(base + path)).text()).length;
  try {
    const history = await size('/api/price/history?range=max');
    const kB = Math.round(history / 1000);
    const [quoted] = claims(readme, /returns \*\*(\d+) kB\*\*/);
    // Prices are appended daily, so allow the series to grow a little.
    if (Math.abs(Number(quoted) - kB) > 25) {
      bad('README history payload size', `says ${quoted} kB, measured ${kB} kB`);
    } else ok(`README history payload size (${quoted} kB, measured ${kB} kB)`);

    const reserves = Math.round((await size('/api/reserves')) / 1000);
    const [quotedR] = claims(dataReadme.concat(readme), /\/api\/reserves\s+(\d+) kB/);
    if (quotedR && Math.abs(Number(quotedR) - reserves) > 5) {
      bad('reserves payload size', `prose says ${quotedR} kB, measured ${reserves} kB`);
    } else ok(`reserves payload size (measured ${reserves} kB)`);
  } catch (err) {
    bad('live measurements', `could not reach ${base}: ${err.message}. Start the API or drop --live.`);
  }
}

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(r.pass ? `  ok    ${r.what}` : `  STALE ${r.what}: ${r.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} documented claims still hold.`);
if (failed.length) {
  console.log('Update the prose, or the config, so they agree.');
  process.exitCode = 1;
}
