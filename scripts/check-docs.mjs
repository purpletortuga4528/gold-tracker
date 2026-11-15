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
import { get as httpGet } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const results = [];
const ok = (what) => results.push({ state: 'ok', what });
const bad = (what, detail) => results.push({ state: 'stale', what, detail });
/**
 * Could not check, and says why.
 *
 * Distinct from both other outcomes on purpose. "The LBMA feed is unreachable
 * from this runner" is not evidence that a documented figure is wrong, and
 * reporting it as stale sends someone to edit prose that was correct. It is
 * not a pass either: the claim went unverified, and the run should say so
 * rather than counting it as checked.
 */
const skip = (what, detail) => results.push({ state: 'skip', what, detail });

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

// --- The same measurement, quoted in three places, must agree -------------
/*
 * The request-burst and payload figures that justify the rate limits appear in
 * the README table, in rateLimit.js beside the numbers they explain, and in
 * .env.example beside the variables. Nothing derives them from anything, so
 * they drift independently, and .env.example had drifted on all three at once:
 * 20 requests for a Compare load that fires 10, about 55 for a five page walk
 * that is 15, and a 60 byte request that is 67.
 *
 * No expected value is written here, deliberately. This asserts only that the
 * three files agree with each other, so correcting one of them is not enough
 * to make the check pass while the other two still disagree.
 */
{
  const rateLimitSrc = read('backend/src/lib/rateLimit.js');
  const figures = [
    ['Compare burst', /(\d+) requests inside a millisecond/],
    ['history request size', /(\d+) byte request/],
    // Three digits or more, and not the tail of a decimal: a bare `(\d+) kB`
    // matched the "3" in rateLimit.js's "0.3 kB" table row and reported the
    // files as disagreeing about a figure all three had right.
    ['history payload size', /(?<![\d.])(\d{3,}) kB/],
  ];

  for (const [what, re] of figures) {
    const seen = [
      ['README.md', claims(readme, re)[0]],
      ['rateLimit.js', claims(rateLimitSrc, re)[0]],
      ['.env.example', claims(envExample, re)[0]],
    ].filter(([, v]) => v !== undefined);

    const distinct = [...new Set(seen.map(([, v]) => v))];
    if (seen.length < 2) {
      skip(`${what} agrees across files`, `quoted in fewer than two of the three files`);
    } else if (distinct.length > 1) {
      bad(`${what} agrees across files`, seen.map(([f, v]) => `${f} says ${v}`).join('; '));
    } else {
      ok(`${what} agrees across files (${distinct[0]}, in ${seen.length})`);
    }
  }
}

// --- Dataset counts quoted in prose ----------------------------------------
{
  const [quoted] = claims(readme, /\((\d+) countries, monthly figures back to/);
  if (Number(quoted) !== dataset.meta.countryCount) {
    bad('README country count', `says ${quoted}, dataset has ${dataset.meta.countryCount}`);
  } else ok(`README country count (${quoted})`);
}
{
  /*
   * The US anchor, which is the most load-bearing number in the project: if
   * the ounce-to-tonne conversion breaks, every dollar figure on every page
   * breaks with it, and this sentence is where that is checked by eye.
   *
   * The previous version of this check could not detect a drifted figure. It
   * was `/8,133\.5 t/.test(dataReadme)`, a presence test: it asked only
   * whether that string appeared somewhere in the file, and the file contains
   * it twice. Changing the one in the sanity-anchor sentence to 8,134.5 left
   * the other satisfying the regex, and the check reported ok against prose
   * that now said something false. It also wrote 8133.5 in twice, which the
   * rule at the top of this file forbids for exactly this reason.
   *
   * Nothing is hardcoded now. The sentence states both the ounces and the
   * tonnes, so the conversion it asserts is recomputed from its own numbers
   * and checked against the dataset, and every other tonnage figure of that
   * magnitude in the file has to agree with it.
   */
  const usa = dataset.countries.find((c) => c.countryCode === 'USA');
  const GRAMS_PER_TROY_OUNCE = 31.1034768; // definitional, not a measurement
  // \s+ rather than literal spaces: the sentence wraps, and the first version
  // of this regex required a single space before the tonnage and so reported
  // the sentence missing on a file where it was present and correct.
  const anchor = /reports\s+([\d,]+)\s+fine troy ounces,\s+giving\s+([\d,]+\.\d+)\s+t/.exec(dataReadme);

  if (!anchor) {
    bad('data/README US anchor', 'the sentence stating the ounces and the tonnes is gone');
  } else {
    const ounces = Number(anchor[1].replace(/,/g, ''));
    const statedTonnes = Number(anchor[2].replace(/,/g, ''));
    const fromOunces = (ounces * GRAMS_PER_TROY_OUNCE) / 1e6;

    // Every figure of that magnitude in the file, so a second mention cannot
    // disagree with the first.
    const sameMagnitude = [...dataReadme.matchAll(/\b(8,\d{3}\.\d+) t\b/g)].map((m) =>
      Number(m[1].replace(/,/g, '')),
    );
    const disagreeing = [...new Set(sameMagnitude)].filter((v) => Math.abs(v - statedTonnes) > 0.1);

    if (Math.abs(fromOunces - statedTonnes) > 0.1) {
      bad('data/README US anchor', `${ounces} oz converts to ${fromOunces.toFixed(2)} t, prose says ${statedTonnes}`);
    } else if (Math.abs(usa.reserveTonnes - statedTonnes) > 0.1) {
      bad('data/README US anchor', `prose says ${statedTonnes} t, dataset says ${usa.reserveTonnes}`);
    } else if (disagreeing.length) {
      bad('data/README US anchor', `the file also says ${disagreeing.join(', ')} t for the same holding`);
    } else {
      ok(`data/README US anchor (${statedTonnes} t, from ${anchor[1]} oz, ${sameMagnitude.length} mentions agree)`);
    }
  }
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

// --- The declared Node floor must satisfy what the dependencies demand ------
// A security update can raise a transitive engine requirement above the floor
// a package declares, and the first sign is a CI job failing on the oldest
// matrix entry. That is what jsdom 30 did in November 2026, taking the floor
// from 22.12 to 22.22.2 without a word in any package.json.
{
  const satisfiesFloor = (floor, range) => {
    // Enough semver for engine ranges of the form ">=x.y.z" and
    // "^a.b.c || ^d.e.f || >=g.h.i". Anything unparsed is reported, not ignored.
    const parse = (v) => v.split('.').map(Number);
    const [fa, fb, fc] = parse(floor);
    const clauses = range.split('||').map((c) => c.trim());
    return clauses.some((clause) => {
      const m = /^(\^|>=)?\s*(\d+)\.(\d+)\.(\d+)$/.exec(clause);
      if (!m) return false;
      const [, op, a, b, c] = m;
      const [ma, mb, mc] = [Number(a), Number(b), Number(c)];
      if (fa !== ma) return op === '>=' ? fa > ma : false;
      if (fb !== mb) return fb > mb;
      return fc >= mc;
    });
  };

  const floors = {
    'package.json': JSON.parse(read('package.json')).engines?.node,
    'frontend/package.json': JSON.parse(read('frontend/package.json')).engines?.node,
  };
  const declared = floors['frontend/package.json'];
  const floor = declared?.replace(/^>=/, '').trim();

  if (!floor || !/^\d+\.\d+\.\d+$/.test(floor)) {
    bad('frontend declares a Node floor', `engines.node is ${JSON.stringify(declared)}`);
  } else if (floors['package.json'] !== declared) {
    bad('the root and frontend floors agree', `root ${floors['package.json']}, frontend ${declared}`);
  } else {
    const offenders = [];
    for (const name of ['jsdom', 'undici', 'vitest', 'vite']) {
      let required;
      try {
        required = JSON.parse(read(`frontend/node_modules/${name}/package.json`)).engines?.node;
      } catch {
        continue; // not installed in this checkout
      }
      if (required && !satisfiesFloor(floor, required)) offenders.push(`${name} wants ${required}`);
    }
    if (offenders.length) {
      bad('the declared Node floor is high enough', `floor is ${floor} but ${offenders.join('; ')}`);
    } else ok(`Node floor (${floor}) satisfies every dependency checked`);
  }
}

// --- No em or en dashes in authored prose ----------------------------------
/*
 * Whole repository, not two files.
 *
 * This checked README.md and data/README.md only, which left the policy
 * enforced on two documents out of a hundred and thirty and spot-checked
 * everywhere else: the provider README, NOTICE.md, .env.example, every source
 * comment and every commit-adjacent file were on trust.
 *
 * The pattern is written with escapes rather than literals, because this file
 * would otherwise trip the check it performs, and a rule enforced by a file
 * that breaks it is a bad rule.
 *
 * EXEMPT is for a file that legitimately needs one, such as a fixture whose
 * whole point is a dash, or a test asserting this very policy. It is empty,
 * and anything added to it wants a reason beside it.
 */
{
  const EXEMPT = new Set([]);
  const skipDir = /node_modules|[/\\]\.git$|[/\\]dist$|test-results|playwright-report|[/\\]\.vite/;
  const skipFile = /\.(png|jpe?g|gif|svg|woff2?|ttf|ico|zip|pdf)$/i;

  const walk = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const p = resolve(dir, entry);
      let s;
      try {
        s = statSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        if (!skipDir.test(p)) out.push(...walk(p));
      } else if (!skipFile.test(p)) {
        out.push(p);
      }
    }
    return out;
  };

  const offenders = [];
  let scanned = 0;

  for (const file of walk(ROOT)) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    if (EXEMPT.has(rel)) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    scanned += 1;
    const n = (text.match(/[\u2013\u2014]/g) ?? []).length;
    if (n) {
      const first = text.search(/[\u2013\u2014]/);
      offenders.push(`${rel}:${text.slice(0, first).split('\n').length} (${n})`);
    }
  }

  if (offenders.length) bad('dash policy', `em/en dashes in ${offenders.join(', ')}`);
  else ok(`dash policy (${scanned} files)`);
}

// --- Every command the docs tell you to run exists -------------------------
/*
 * A named script that is not there is the first thing a new reader hits, and
 * nothing else here would notice it going missing. Four documents told people
 * to run `npm run verify:provider`, and two told them `npm run
 * check:freshness`, neither of which existed outside backend/package.json: a
 * reader following any of those from the repository root got "Missing script".
 * The README even contradicted itself, writing the prefixed form in its
 * command list and the bare form in its prose.
 *
 * Checked against the manifests rather than by running anything, so this stays
 * part of the static half.
 */
{
  const scriptsIn = (manifest) => Object.keys(JSON.parse(read(manifest)).scripts ?? {});
  const packages = {
    '': scriptsIn('package.json'),
    backend: scriptsIn('backend/package.json'),
    frontend: scriptsIn('frontend/package.json'),
  };

  /*
   * Every one of these must exist. An earlier version skipped a file it could
   * not read, which meant deleting NOTICE.md outright left this reporting that
   * all claims hold: the licence notice for somebody else's data, gone, and
   * the checker satisfied. "Not there" is the most complete way for a document
   * to be wrong.
   */
  const docFiles = [
    'README.md',
    'backend/data/README.md',
    'backend/src/services/priceProviders/README.md',
    'NOTICE.md',
    'LICENSE',
    'backend/.env.example',
    'Dockerfile',
    'deploy/gold-tracker.service',
    '.github/workflows/ci.yml',
  ];

  const broken = [];
  let checked = 0;

  for (const file of docFiles) {
    let text;
    try {
      text = read(file);
    } catch (err) {
      broken.push(`${file} is missing: ${err.code ?? err.message}`);
      continue;
    }

    /*
     * The script name may carry a colon and a hyphen, which is why this is not
     * `[a-z:]+`: that pattern read `check:price-feed` as `check:price` and
     * reported a script that exists as missing. An optional `-- <args>` run
     * may sit between the name and a `--prefix`.
     */
    for (const m of text.matchAll(/npm run ([a-z][a-z:-]*[a-z])(?:\s+--\s+[^\n`|]*?)?(?:\s+--prefix\s+(\w+))?(?=[\s`.,)]|$)/g)) {
      const [, script, prefix = ''] = m;
      const where = packages[prefix];
      const label = `npm run ${script}${prefix ? ` --prefix ${prefix}` : ''}`;
      checked += 1;
      if (!where) broken.push(`${file}: unknown prefix in ${label}`);
      else if (!where.includes(script)) broken.push(`${file}: ${label} does not exist`);
    }
  }

  if (broken.length) bad('every documented command exists', [...new Set(broken)].join('; '));
  else ok(`every documented command exists (${checked} mentions across ${docFiles.length} files)`);
}

// --- The pre-paint boot script agrees with the React side -----------------
/*
 * index.html resolves the saved appearance before first paint, which means it
 * duplicates the storage keys and the value allowlists that useTheme.jsx owns.
 * Nothing reconciles them at runtime. A drift gives exactly the flash of the
 * wrong theme the script was added to prevent, and only on a real page load in
 * a browser with something already in localStorage, which is the hardest case
 * to notice and the one no unit test sees.
 */
try {
  const html = read('frontend/index.html');
  const theme = read('frontend/src/lib/useTheme.jsx');

  const pairs = [
    ['theme key', /THEME_KEY = '([^']+)'/, /pick\('([^']+)', \['light'/],
    ['font key', /FONT_KEY = '([^']+)'/, /'([^']+)', \['default'/],
    ['contrast key', /CONTRAST_KEY = '([^']+)'/, /'([^']+)', \['normal'/],
    ['themes', /const THEMES = \[([^\]]+)\]/, /\[('light'[^\]]*)\]/],
    ['fonts', /const FONTS = \[([^\]]+)\]/, /\[('default'[^\]]*)\]/],
    ['contrasts', /const CONTRASTS = \[([^\]]+)\]/, /\[('normal'[^\]]*)\]/],
  ];

  const norm = (s) => s.replace(/\s+/g, '');
  const drifted = [];
  for (const [what, jsRe, htmlRe] of pairs) {
    const inJs = claims(theme, jsRe)[0];
    const inHtml = claims(html, htmlRe)[0];
    if (inJs === undefined || inHtml === undefined) drifted.push(`${what}: could not be read from both files`);
    else if (norm(inJs) !== norm(inHtml)) drifted.push(`${what}: useTheme has ${inJs}, index.html has ${inHtml}`);
  }

  if (drifted.length) bad('index.html boot script matches useTheme.jsx', drifted.join('; '));
  else ok(`index.html boot script matches useTheme.jsx (${pairs.length} keys and lists)`);
} catch (err) {
  // Reported, not thrown. An unreadable input made this whole script die with
  // an ENOENT stack trace, which is the least useful thing a checker can do:
  // the point of it is to name the claim it could not stand behind.
  bad('index.html boot script matches useTheme.jsx', `could not be read: ${err.message}`);
}

// --- No component names a benchmark ------------------------------------
/*
 * The chart's tooltip used to read "LBMA PM fix" from a string literal, for
 * every provider. Under PRICE_PROVIDER=demo that put a real benchmark's name
 * on invented numbers, and under metals.dev it called that provider's generic
 * spot series the PM auction result.
 *
 * What makes this worth a standing check rather than a one-off fix is that the
 * backend already defended it. demo-provider.test.js asserts the demo
 * provider's own `benchmark` field never says LBMA; the frontend simply did
 * not read the field that assertion protects. A guarantee the UI can bypass
 * with a literal is not a guarantee, and the next component to label a series
 * would bypass it the same way.
 *
 * Provider modules are exempt: naming the benchmark is their job.
 */
{
  const components = execFileSync(
    process.execPath,
    [
      '-e',
      `const {readdirSync,statSync}=require('fs'),{join}=require('path');
       const out=[];(function walk(d){for(const e of readdirSync(d)){const p=join(d,e);
       if(statSync(p).isDirectory())walk(p);else if(/\\.jsx?$/.test(e)&&!/\\.test\\./.test(e))out.push(p);}})(process.argv[1]);
       console.log(out.join('\\n'));`,
      resolve(ROOT, 'frontend/src'),
    ],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);

  /*
   * Comments are blanked before scanning, because explaining this rule means
   * quoting the string it forbids. Done across the whole file rather than per
   * line, since a JSX `{/* ... *\/}` block spans lines and its continuation
   * lines look like ordinary code. Newlines are preserved so the line numbers
   * reported below are the real ones.
   */
  const stripComments = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

  /*
   * Any mention outside a comment, not just one inside quotes.
   *
   * The first version of this check only matched quoted string literals, and
   * so passed while the footer in App.jsx told every reader on every page that
   * the price came from the LBMA daily auction. JSX renders bare text, which
   * carries no quotes, and that is the most visible place a component can
   * assert something. A check that only inspects the syntax the last bug
   * happened to use is the same blind spot the contrast audit had.
   */
  const offenders = [];
  for (const file of components) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const [i, line] of code.split('\n').entries()) {
      if (/\bLBMA\b/.test(line)) {
        offenders.push(`${file.slice(ROOT.length + 1).replace(/\\/g, '/')}:${i + 1}`);
      }
    }
  }

  if (offenders.length) {
    bad('no frontend component names a benchmark', `${offenders.join(', ')} should read it from the response`);
  } else {
    ok(`no frontend component names a benchmark (${components.length} files scanned)`);
  }
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

  /*
   * NOTICE.md says the IMF licence and citation are reproduced verbatim. That
   * is the one claim in this repository with legal weight rather than
   * documentary weight, and it is a claim about somebody else's wording, so it
   * can stop being true without anything here changing. If the IMF rewords
   * either string, that file silently becomes a misquote.
   *
   * One tiny query, one country and one month, carries both attributes.
   */
  {
    const notice = read('NOTICE.md');
    const url =
      'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,IRFCL/USA.IRFCLDT1_IRFCL56V_FTO..M' +
      '?startPeriod=2026-07&endPeriod=2026-07';
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();

      const attr = (name) => new RegExp(`${name}="([^"]*)"`).exec(xml)?.[1];
      // Compared with whitespace collapsed: NOTICE.md wraps both strings over
      // two lines and renders the URLs as Markdown autolinks, neither of which
      // changes a word.
      // Brackets out first, whitespace collapsed second, and in that order:
      // doing it the other way leaves a double space wherever a "> " blockquote
      // marker was removed, so the strings failed to match while being
      // word-for-word identical.
      const flat = (s) =>
        s
          .replace(/[<>]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      const noticeFlat = flat(notice);

      const drifted = [];
      for (const name of ['LICENSE', 'SUGGESTED_CITATION']) {
        const value = attr(name);
        if (!value) drifted.push(`${name} is no longer in the response`);
        else if (!noticeFlat.includes(flat(value))) {
          drifted.push(`${name} now reads: ${flat(value).slice(0, 120)}`);
        }
      }

      if (drifted.length) bad('NOTICE.md quotes the IMF verbatim', drifted.join('; '));
      else ok('NOTICE.md quotes the IMF verbatim (LICENSE and SUGGESTED_CITATION)');
    } catch (err) {
      skip('NOTICE.md quotes the IMF verbatim', `the IMF API could not be read: ${err.message}`);
    }
  }

  /**
   * Whether a route can be measured at all right now.
   *
   * The history route is served from the live LBMA feed, and that feed is not
   * reliably reachable from a CI runner. When it is down the API answers 502
   * with a short body, which reads exactly like a documented 694 kB figure
   * having gone stale. It is not: it is a claim that could not be checked,
   * and saying so is the only honest reading of it.
   */
  const measurable = async (path) => {
    const res = await fetch(base + path);
    if (res.ok) return { ok: true };
    const body = await res.text();
    return { ok: false, why: `the API answered ${res.status}: ${body.slice(0, 120)}` };
  };
  try {
    // A claim this cannot find is a FAILURE, not a pass. The first version
    // compared `Number(undefined)`, and NaN fails every comparison, so
    // rewording the sentence around the figure turned the check green while it
    // was reading nothing at all. A checker that reports "ok" for a claim it
    // could not locate is worse than no checker.
    const historyAvailable = await measurable('/api/price/history?range=max');
    const history = historyAvailable.ok ? await size('/api/price/history?range=max') : 0;
    const kB = Math.round(history / 1000);
    const [quoted] = claims(readme, /is \*\*(\d+) kB\*\* for a \d+ byte request/);
    if (!historyAvailable.ok) {
      skip('README history payload size', `${historyAvailable.why}. LBMA is upstream of this route, so this says nothing about the documented figure.`);
    } else if (quoted === undefined) {
      bad('README history payload size', 'no figure found; has the sentence been reworded?');
    } else if (Math.abs(Number(quoted) - kB) > 25) {
      // Prices are appended daily, so allow the series to grow a little.
      bad('README history payload size', `says ${quoted} kB, measured ${kB} kB`);
    } else ok(`README history payload size (${quoted} kB, measured ${kB} kB)`);

    // The size table lives in the rate limiter's own docblock, which is the
    // file that acts on those numbers. Both columns are checked: uncompressed,
    // and what a caller accepting gzip actually receives.
    const limiterSource = read('backend/src/lib/rateLimit.js');
    // node:http, not fetch. undici decompresses transparently, so `fetch` hands
    // back the decoded body and measuring it reports the uncompressed size with
    // no sign that anything was wrong. Counting raw socket bytes is the only
    // way to measure what actually crossed the wire.
    const gzipped = (path) =>
      new Promise((resolveSize, rejectSize) => {
        const req = httpGet(
          { host: '127.0.0.1', port: config.port, path, headers: { 'accept-encoding': 'gzip' } },
          (res) => {
            if (res.headers['content-encoding'] !== 'gzip') {
              res.resume();
              resolveSize(null);
              return;
            }
            let bytes = 0;
            res.on('data', (chunk) => { bytes += chunk.length; });
            res.on('end', () => resolveSize(Math.round(bytes / 1000)));
          },
        );
        req.on('error', rejectSize);
      });

    for (const [label, path, re, tolerance] of [
      ['reserves', '/api/reserves', /\/api\/reserves\s+(\d+) kB -> ([\d.]+) kB/, 5],
      ['history', '/api/price/history\?range=max', /range=max\s+(\d+) kB -> (\d+) kB/, 25],
    ]) {
      const m = re.exec(limiterSource);
      if (!m) {
        bad(`rateLimit.js quotes the ${label} size`, 'the table row could not be read');
        continue;
      }
      if (label === 'history' && !historyAvailable.ok) {
        skip(`rateLimit.js ${label} size`, historyAvailable.why);
        continue;
      }
      const plain = Math.round((await size(path.replace('\?', '?'))) / 1000);
      if (Math.abs(Number(m[1]) - plain) > tolerance) {
        bad(`rateLimit.js ${label} size`, `says ${m[1]} kB, measured ${plain} kB`);
        continue;
      }
      const small = await gzipped(path.replace('\?', '?'));
      if (small === null) {
        bad(`rateLimit.js ${label} compressed size`, 'the response came back uncompressed');
      } else if (Math.abs(Number(m[2]) - small) > Math.max(1, tolerance / 5)) {
        bad(`rateLimit.js ${label} compressed size`, `says ${m[2]} kB, measured ${small} kB`);
      } else ok(`rateLimit.js ${label} size (${m[1]} kB, ${m[2]} kB gzipped; measured ${plain} and ${small})`);
    }
  } catch (err) {
    bad('live measurements', `could not reach ${base}: ${err.message}. Start the API or drop --live.`);
  }
}

const failed = results.filter((r) => r.state === 'stale');
const skipped = results.filter((r) => r.state === 'skip');
const checked = results.filter((r) => r.state === 'ok');
const LABEL = { ok: '  ok   ', stale: '  STALE', skip: '  SKIP ' };
for (const r of results) {
  console.log(r.detail ? `${LABEL[r.state]} ${r.what}: ${r.detail}` : `${LABEL[r.state]} ${r.what}`);
}
console.log(`
${checked.length}/${checked.length + failed.length} documented claims still hold.`);
if (skipped.length) {
  console.log(`${skipped.length} could not be checked on this run, listed above as SKIP.`);
}
if (failed.length) {
  console.log('Update the prose, or the config, so they agree.');
  process.exitCode = 1;
}
