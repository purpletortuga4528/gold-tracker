# Gold Tracker

Central bank gold reserves by country, valued at the current gold price.

Two datasets, joined: how much gold each reporting economy holds (tonnes), and
what an ounce of gold costs (USD). Multiply them and you get what a country's
gold is worth today, which is the thing neither source gives you on its own.

**The reserve data needs no API key and no signup.** The IMF publishes it over
an open SDMX API and that half of the app works out of the box.

**The price does need one now.** LBMA closed its open feed in late 2026 and the
benchmark went behind an ICE Benchmark Administration licence. The app ships a
provider for metals.dev, which republishes the LBMA fix and has a free tier, and
a clearly labelled generated-data provider for demonstrations. Without either,
tonnages and every reserve figure still work and the price panel says why it
cannot. [What happened, and what the options are](#the-price-feed-closed).

## Quick start

To run it:

```bash
npm run setup
npm start
```

Then open http://localhost:5174. One process, one port: the API serves the
built app alongside its own JSON, so there is no proxy to configure and nothing
is cross-origin. `npm start` builds first, so it is the only command needed.

To work on it, with hot reloading:

```bash
npm run dev
```

Then open http://localhost:5173. Vite serves the app and proxies `/api` to the
API on 5174, and the API is told not to serve its own copy of the build, so an
edit cannot appear on one port and not the other.

**Node 22.22.2 or newer** to work on it, which is what jsdom 30 requires. That
floor rose from 22.12 when the November 2026 security updates landed, and
check:docs now compares what the packages declare against what the installed
dependencies actually demand, because this is the third documented number here
to drift quietly. **The API itself runs on Node 20.6**, and CI proves that separately by
installing only the backend on 20.6 and serving real data from it. Developed on
Node 24.

```bash
npm test              # both suites: 111 backend, 152 frontend
npm run test:backend
npm run test:frontend
npm run test:coverage
npm run test:browser  # contrast, axe and the keyboard, in a browser, four modes
npm run build         # production frontend build
npm run build:data    # refresh the reserves snapshot from the IMF
npm run check:docs    # do the figures quoted in these docs still match reality?
npm run check:ingest  # did a rebuild break the dataset? (see the script for its two arguments)
npm run check:price-feed  # does the LBMA feed still mean what the provider reads?
npm run check:freshness --prefix backend   # is the snapshot stale? exits 0/1/2
```

CI runs the tests, the contrast audit, the build, the docs check, the freshness
check and `npm audit` on every push and pull request, and again weekly, because
two of those go stale on their own rather than when someone changes the code:
the IMF snapshot ages, and an advisory can be published against a dependency
nobody has touched. Coverage runs as part of the docs check, which compares it
against the figure quoted below.

One job runs weekly only, and on demand: the one that talks to the two upstream
feeds. A red build on every pull request because the IMF was restarting would
teach people to ignore red builds, and a week sits well inside IRFCL's monthly
publication cycle.

It does two things. `build:data` rebuilds from the IMF and `check:ingest`
compares the result against the committed snapshot, failing on shapes that mean
the pipeline broke and merely reporting figures that moved, because a central
bank buying gold is the data working. And `check:price-feed` confirms the LBMA
feed still has the shape `lbma.js` reads, which matters more than it sounds.

## Hosting it

Three ways, in order of how little you have to think about.

**Docker.** One service, one port, no database and no reverse proxy:

```bash
docker compose up -d
```

The image is two stages, so no build tooling reaches the running container. It
runs as a non-root user, writes only the directory holding the snapshot, and
its healthcheck reports unhealthy when the data goes stale as well as when the
process is down: a container that is up and serving a snapshot nobody has
rebuilt in seventy days is not healthy in any sense that matters, and a check
that only pings the port would call it fine. A named volume keeps the refreshed
snapshot across rebuilds.

**systemd**, if you would rather not use Docker. A unit is in
[deploy/gold-tracker.service](deploy/gold-tracker.service), with the hardening
options set and `ReadWritePaths` limited to the one directory the app writes.
Build once with `npm run setup && npm run build`, then enable it.

**Directly**, which is fine for a machine you are sitting at:

```bash
npm start
```

All three stop cleanly. The app handles `SIGTERM` by closing the listener and
letting in-flight requests finish, so `docker stop` and `systemctl stop` take
well under a second instead of waiting out a timeout and killing the process.

**All three listen on every interface**, which is Node's default and is kept,
because a container or a home server that answered only on its own loopback
would be useless. It is worth saying out loud rather than leaving to be
discovered: starting it and publishing it on your network are the same act.
`HOST=127.0.0.1` keeps it to the machine it runs on, and under Docker the port
mapping is the place to decide it (`"127.0.0.1:5174:5174"`). The startup banner
prints which interface it took either way.

You do not need a cron entry for the data. The snapshot refreshes itself while
the server runs.

## Where the data comes from

### Reserves: IMF IRFCL

The [IMF International Reserves and Foreign Currency Liquidity
dataset](https://data.imf.org/en/datasets/IMF.STA:IRFCL) publishes each
reporting economy's gold holding as a volume in fine troy ounces, over an open
SDMX API with no key. `npm run build:data` pulls it, converts to tonnes and
writes `backend/data/gold-reserves.json` (85 countries, monthly figures back to
2010).

This replaces the "download a spreadsheet from the World Gold Council by hand"
approach: the snapshot is reproducible from a single command, and every figure
is traceable to a query URL recorded in the file's own metadata.

The dataset has real quirks, all handled in the ingest and all documented in
[backend/data/README.md](backend/data/README.md): duplicate series per economy,
aggregates mixed in with countries, and reporters filing the gold line in the
wrong unit. That last one matters. Brazil's raw figure implies 172,446 tonnes,
which would make it the largest holder on earth twenty times over.

Those errors are **detected from the data**, not read from a hand-maintained
list. A correction runs only when the figure is impossible as filed *and* a
power of ten restores the reporter's own implied price to the market price of
the month it filed. Both halves are load-bearing: the ratio test alone
"corrected" Korea and Tunisia, whose figures were right all along and which
simply carry gold at cost. Anything impossible that no power of ten explains is
quarantined rather than published, except an aggregate: the Euro Area row is 21
central banks plus the ECB and legitimately sits past any single-country
ceiling.

**What this data is not:** a world total. IRFCL covers subscribers to the IMF
reserves template, so non-reporting holders and the IMF's and BIS's own gold are
absent. A footer on every page says the data is not a complete picture, and the
dashboard carries the full provenance panel spelling out that the rows must not
be summed into a world figure.

### The price feed closed

Until late 2026 the London Bullion Market Association published its daily
auction benchmark as open JSON, in USD, GBP and EUR, back to April 1968. No key,
no signup, the full history. This app was built around it.

Between 9 September and 10 October 2026 that ended. The whole
`prices.lbma.org.uk` subdomain went behind Cloudflare: 401 at the root, 403 on
every path, for browsers as well as scripts. LBMA's own site now says a licence
from IBA "is required in order to obtain, use or redistribute real-time or
historical benchmark data", and the tables moved to a portal behind it. The
other free routes had already gone: FRED deleted its ICE Benchmark
Administration series in January 2022, and the World Gold Council removed
historical LBMA prices in March 2025 at ICE's request.

So there is no free route to the benchmark left, and `lbma.js` is kept for
whoever can still reach it rather than deleted. It fails with that explanation
rather than a generic network error, and only claims the closure when it
actually sees a 401 or 403, because "I could not connect" and "this was
withdrawn" are different facts.

**Three options, none of them a default that pretends to work:**

| `PRICE_PROVIDER` | What you get |
|---|---|
| `lbma` (default) | Nothing, unless the feed reopens. Reserves are unaffected |
| `metalsdev` | The real LBMA AM and PM fixes, via metals.dev. Free key required |
| `demo` | Generated prices, labelled as such everywhere they appear |

**metals.dev needs a free key** and has a 100 request a month tier. That is
about three a day, and the cache lifetimes this app ships would spend a month's
quota before lunch, so the server does that arithmetic at startup and tells you
what to set. See `backend/.env.example`.

**That provider has never been run.** It is written from metals.dev's published
documentation and is marked `verified: false` everywhere it surfaces, because
two adapters written that way were deleted from this repository rather than
shipped. `npm run verify:provider -- metalsdev` makes one real call and prints
the raw response beside what the adapter read from it. Do that before trusting
a number it produces, and send a patch flipping the flag if it holds up.

It is **not a live spot feed**. The auction runs twice a day, so the price you
see is the most recent published fix, tagged with its date. The app says
"daily benchmark", not "live", because it is one and not the other.

If you want intraday spot, the LBMA feed will not give it to you: add a
provider. `backend/src/services/priceProviders/README.md` documents the
interface, which is one required method.

Adapters for GoldAPI.io and MetalpriceAPI used to ship here. They were written
from published documentation and never executed, because running them needs an
account, and they were labelled unverified in the code, in the API response and
in this file. That labelling was accurate, but a release should not carry code
nobody has ever run, so they were removed and replaced with a document that
records the interface and the traps: unit conversions that produce a
plausible-looking wrong number, fallback fields that mean something else, and
per-date history endpoints that bill one call per day of chart.

`npm run verify:provider -- <id>` makes one real call and prints the raw
response beside what the adapter extracted, so a new one can be checked before
it is trusted.

Keys stay server side. The frontend never calls a provider and never sees a key.

### Showing the app without a price feed

In October 2026 the LBMA feed went behind a Cloudflare challenge and began
answering 403 to anything that is not a browser. The app degrades honestly when
that happens: reserve tonnages are unaffected because they do not depend on a
price, and the headline, the chart, the dollar values and the share column say
so rather than guessing. That is the right behaviour and it is useless for
showing somebody what the app does.

So there is a second provider, and it is not a data source:

```bash
PRICE_PROVIDER=demo npm start
```

**Every number it produces is invented.** It generates a daily series from a
fixed seed, so the same chart appears on every run, shaped to look like gold's
history only so that a chart of it reads as a chart. It is never the default
and a test asserts that. It says what it is in the provider label, in a warn
pill beside the price reading "Not a real price", in the note under the
headline, in `/api/price/providers`, and in the startup banner, which refuses
to be quiet about it:

```
price provider: DEMONSTRATION DATA (not real prices)
!! EVERY PRICE THIS SERVES IS GENERATED. Not real data, for
   demonstration only. Unset PRICE_PROVIDER to use the real feed.
```

## Features

- **Dashboard** with the current price, a historical chart (1m to max), the top
  ten holders, and their combined value.
- **Countries** table, sortable by every column except the rank number,
  searchable by name, ISO code or region, filterable by region, with USD value
  and gold's share of total reserves computed per row.
- **Country detail** with the current holding in tonnes and ounces, its value,
  its share of total reserves, and the full month-by-month reported history.
- **Compare** two or more economies side by side, with their histories on one
  axis.
- **Light, dark and system themes**, a **high contrast** mode, and an
  **Atkinson Hyperlegible Next** typeface view. All three are independent, all
  persist, and all are applied before first paint.

## Layout

```
gold-tracker/
  backend/
    src/
      index.js           listens, prints the limits, handles SIGTERM
      app.js             middleware order, health, the error handler
      config.js          every environment variable, parsed and guarded
      routes/            price and reserves HTTP routes
      services/
        priceProviders/  lbma.js (closed), metalsdev.js, demo.js
        price.js         provider selection, caching, stale fallback
        reserves.js      dataset loading, search and filtering
        freshness.js     how stale the snapshot is, on two clocks
        refresh.js       rebuilds the snapshot on a schedule
      lib/
        units.js         troy ounce conversions, the one place they live
        cache.js         TTL cache with in-flight de-duplication
        http.js          query validation, HttpError, security headers
        rateLimit.js     the three buckets, and the proxy warning
        serveFrontend.js the built app, its own CSP, the SPA fallback
    scripts/
      build-reserves.mjs  regenerates the dataset, with unit detection
      verify-provider.mjs one real call against a provider, printed raw
      check-freshness.mjs exit code says whether the snapshot is stale
    data/                generated dataset plus its config and its README
    test/
  frontend/
    src/
      pages/             Dashboard, Countries, CountryDetail, Compare
      components/        table, charts, price headline, provenance panel
      lib/               API client, formatting, price context, appearance
      index.css          the whole palette, and the high contrast layer
    e2e/                 the contrast audit, run in a real browser
  scripts/
    dev.mjs              runs both servers with one Ctrl+C
    check-docs.mjs       verifies figures quoted in the docs against reality
    check-ingest.mjs     compares a fresh dataset against the committed one
    check-price-feed.mjs the LBMA feed still means what the provider reads
  .github/workflows/ci.yml
```

## Things worth knowing if you extend this

**Troy ounces, not grams.** A tonne is 32,150.7466 troy ounces, not a million
grams' worth. Getting this wrong inflates every value by about 31x, and it is
the single easiest way to make this app confidently wrong. The conversion lives
in one place per side (`backend/src/lib/units.js`, `frontend/src/lib/format.js`)
and is covered by a test that pins the US figure to its published tonnage.

**One price for the whole app.** The frontend holds the spot price in a single
React context, so a table and a detail page cannot disagree about what a
country's gold is worth.

**Caching is about the provider, not about speed.** The TTL cache also
de-duplicates in-flight requests, so ten browser tabs opening at once make one
upstream call, not ten. If a refresh fails and a stale value exists, the API
serves the stale value flagged as stale rather than blanking the dashboard.

**Gold's share of reserves is computed, never read off.** Reporters value gold
inconsistently, so the IMF's own ratio puts US gold at about 4 percent of US
reserves against a published figure near 84 percent. What the dataset stores is
non-gold reserves, the one quantity stable across valuation methods; the share
is restated at the live gold price and moves with it. It tracks published shares
closely but does not reproduce them exactly, and
[backend/data/README.md](backend/data/README.md) records how far off it runs.

**The data refreshes itself.** Detecting staleness was never the hard part: the
app already said so on every page and in `/api/health`. The problem was that
saying so did nothing, so a self-hosted copy would drift and the banner would
become wallpaper. The server now rebuilds the snapshot from the IMF on start
and every six hours, but only when it is more than a day old, since IRFCL
publishes monthly and there is nothing to gain from rebuilding more often.

It never blocks startup, never leaves the app worse off, and runs the same code
path as `npm run build:data` as a child process. A failed rebuild changes
nothing: the ingest writes to a temporary file and renames, so the served
dataset is either the old complete one or the new complete one, never a
half-written file. Set `AUTO_REFRESH=false` to pin a snapshot instead.

**Staleness is treated as a bug, not a cosmetic detail.** The snapshot's build
date and the data's own date are graded on separate clocks, because IRFCL always
reports with a lag. `/api/health` reports `ok: false` when the snapshot goes
stale, a banner appears in the app, and `npm run check:freshness` exits non-zero
for CI. The failure this guards against is the quiet one: everything works while
the numbers stop being current.

**One palette, no `dark:` variants.** Colour lives in `--c-*` custom properties
in `src/index.css`, which Tailwind's `@theme` maps onto names like `bg-surface`
and `text-ink/60`. Switching theme swaps the palette and everything follows, so
components carry no per-theme classes. Recharts takes colours as props rather
than classes, so `useChartColors` reads the same properties back out of the
computed style; that is why the charts cannot drift onto their own hex codes.

There is deliberately no `prefers-color-scheme` query in the CSS. A small inline
script in `index.html` resolves "system" to an explicit `data-theme` before first
paint, and `AppearanceProvider` keeps it in step afterwards. That avoids a
flash of the wrong theme, which matters most for exactly the people who chose
dark mode, and it keeps one dark palette rather than two that must agree.

**High contrast is orthogonal to theme, not a fourth theme.** Needing high
contrast and preferring a dark ground are different needs, so `data-contrast`
layers on top of `data-theme` and high-contrast dark is reachable. Grounds go
pure, borders become ink, chart gradients are dropped for thicker strokes.

The palette alone was not enough, and the way it was patched turned out to be
the bug. Secondary text used to be ink at reduced opacity (`text-ink/50` and
friends), which Tailwind compiles to a `color-mix` against transparent. Pure
black at 50 percent on white is `#808080`, about 3.9:1, and the fade happens
after the palette, so no palette can rescue it. High contrast worked around
that by restoring full opacity on a hand-listed set of generated class names,
which left the two normal-contrast modes failing and meant any new opacity step
quietly reopened the hole.

Secondary text is now two solid tokens, `--c-ink-muted` and `--c-ink-subtle`,
defined per theme. That is what makes it checkable: solid colours can be read
straight out of `index.css` and composited in Node, so
`frontend/src/lib/palette.test.js` asserts every text token against every
ground it can land on, including the tinted chips, in all four modes. No
browser, no CSS engine, and it runs in CI with the rest of the suite.

**The tests cover behaviour, not lines.** 263 of them: 111 backend, 152 frontend.
The frontend suite covers 86 percent of statements with `coverage.all` enabled,
so untested files count as zero rather than being left out of the report. What
is deliberately not covered is `App.jsx`, `Dashboard.jsx` and `PriceChart.jsx`:
routing, composition, and a Recharts component whose drawing jsdom cannot
meaningfully verify. A chart that passes in jsdom is not evidence it renders.

**Contrast is measured, not eyeballed.** Two checks, because neither is
sufficient alone, and both run in CI.

`src/lib/palette.test.js` reads the palette straight out of `index.css` and
composites every text token against every ground it can land on. No browser, so
it runs with the rest of the unit suite in about a second.

`npm run test:browser` is the other half: Playwright loads the built app, in
all four modes, and walks every rendered text element computing the real ratio
against its resolved background. That is the only thing that catches a colour a
component invented for itself, or a background token colliding with a text
token on one element. Sampled on `/countries`, the densest page, which renders
every row; the element count is lower on other pages:

| Mode | Bar | Worst measured | Failing |
|---|---|---|---|
| light / normal | AA 4.5 | 5.37 | 0 of 643 |
| light / high | AAA 7.0 | 11.52 | 0 of 643 |
| dark / normal | AA 4.5 | 6.45 | 0 of 643 |
| dark / high | AAA 7.0 | 15.37 | 0 of 643 |

An element counts if it has a direct non-empty text node, is visible, and has a
non-zero box. Those four rows are printed by `npm run test:browser`, so this
table is one command to re-derive rather than a number somebody remembers.

Three real defects came out of running it, and the third is the one worth
repeating. The light accent was darkened from `#a37814` to `#8a6412`, because
white button labels on the original measured 4.00:1. The "unit fix" pill
rendered black on black in light high contrast, a ratio of exactly 1.00,
because its background token becomes ink there; it is now an outlined chip.

The third was the audit itself. Its colour parser matched `rgb()` and `rgba()`,
and Chrome reports Tailwind's `color-mix` opacity utilities as `oklab(...)`, so
every faded element was skipped without a word. That is precisely the set of
elements at risk. Every row of the table above used to read "0 of 622"; in fact
187 of the 638 elements the page carried then were below AA in light normal, and
86 in dark normal, the rank column at 2.52:1. The two high-contrast rows happened to be right, because high
contrast restored those elements to full opacity and left nothing for the parser
to miss, which is what made the gap look like a passing result rather than a
blind spot. The check reported the worst element it could parse and called it
the worst element. A measurement that silently drops its hardest cases is worse
than none, because it gets quoted.

Two habits came out of that, and both are now enforced rather than remembered.
The audit parses `oklab()`, and it counts what it could not parse and fails if
that is anything but zero, so the next colour syntax nobody anticipated stops
the build instead of quietly leaving the sample. And it lives in the repository
now: it used to be a snippet pasted into a console, which is most of the reason
it was allowed to be wrong for so long.

Measure on a real page load, not by flipping `data-theme` in the console and
reading `getComputedStyle` straight after. Doing the latter returns styles the
browser has not recalculated, which reports confident nonsense.

**Atkinson Hyperlegible Next is self-hosted**, via
`@fontsource-variable/atkinson-hyperlegible-next` (OFL-1.1), not loaded from a
font CDN, so the app works offline and no request about the reader leaves the
machine. Google Fonts credits it to the Braille Institute, Applied Design Works,
Elliott Scott, Megan Eiswerth and Letters From Sweden; it is the 2024 second
version of Atkinson Hyperlegible, whose letterforms are drawn so that easily
confused characters stay distinct. Table cells are `whitespace-nowrap`: the
face is wider than the system stack, and without it rows wrap instead of the
table scrolling.

**Self-hosting is one process, and the two policies differ.** In production the
API serves the built app from `frontend/dist`, mounted after the API routes so
`/api/*` can never be answered by the client-routing fallback. That fallback is
restricted to navigations: a request for a missing `/assets/*.js` returns 404
rather than the app shell, because answering 200 with HTML makes the browser
report a syntax error in a file that does not exist.

The Content Security Policy is deliberately not shared. The API sends
`default-src 'none'`, which is right for JSON and would block the app's own
bundle. The app gets `'self'` throughout, plus two concessions with reasons:
`script-src-elem 'unsafe-inline'` for the theme boot script, which must run
before first paint and so cannot be a separate request, and `style-src-attr
'unsafe-inline'` because React and Recharts set style attributes and the charts
render unstyled without it. No external origin appears in the policy at all: the
typeface is self-hosted and the API is same-origin.

**Responses are compressed**, which is the largest single thing this server
does to anyone's connection. The chart's full history is 694 kB of JSON and the
app bundle is 624 kB; they are 83 kB and 180 kB over the wire. A first load
drops from about 700 kB to about 250 kB. Bodies under 1 kB are left alone,
because the header and the CPU cost more than they would save, and the fonts
are `woff2`, which is already compressed.

Worth saying why this is safe rather than just fast, since compressing a
response is not always either. BREACH needs a secret in the body and
attacker-influenced text beside it, so that the compressed length leaks the
secret a byte at a time. Nothing here qualifies: no authentication, no session,
no cookie, no per-caller data. Every response is the same public JSON for
everyone. If that ever stops being true, the middleware in `app.js` is the line
to revisit before the feature ships.

If the app has not been built, the API says so on a plain page pointing at
`npm run build`, rather than serving a broken page or a bare 404.

**Colour is the half of accessibility that is easy to measure.** The other half
had never been checked at all, which is a lopsided place to stop for an app that
ships a hyperlegible typeface and a high-contrast mode. `npm run test:browser`
now runs axe over all four pages in all four appearance modes, and drives the
keyboard.

It found two things on its first run. Three of the four pages had no level-one
heading, because what looks like each page's heading is a card title and `Card`
renders `h2`. Somebody navigating by headings arrived at a page with nothing to
orient by. `Card` now takes a `titleAs`, the page that leads with a titled card
passes `h1`, and the dashboard, which opens with a price rather than a title,
carries a visually hidden one. Two table columns also had empty header cells, so
the selection and remove columns were unnamed in a table summary.

A skip link came out of it as well, which axe does not flag because it is not a
rule. Without one a keyboard user re-walks the navigation and the three
appearance toggles on every route change, which on a four page app is most of
the tab presses they will ever make here.

What none of that does is establish that the app is accessible. These rules
catch a fraction of what matters, and nothing here substitutes for someone using
a screen reader in earnest. What it does is stop the fraction it covers from
regressing quietly, which is why everything else in this file is checked rather
than remembered.

**Both feeds are read by position, so both are checked.** The ingest maps SDMX
attributes by name and is comparatively safe. The price provider is not:

```js
const CURRENCY_INDEX = { USD: 0, GBP: 1, EUR: 2 };
```

A row is `{"is_cms_locked":0,"d":"2026-09-08","v":[4399.1,3246.1,3784.55]}`.
There are no labels, and that undocumented `is_cms_locked` is a fair hint that
the shape is nobody's contract.

The failure worth guarding is not the feed vanishing. That throws, the route
answers 502, and the app says so on the page. It is the feed being reordered:
gold would be reported at the euro price, every country's valuation would come
out about fourteen percent light, and every figure on every page would look
completely ordinary. `check:price-feed` checks the things that would give that
away, weekly: three values and not four, a date in the format expected, a price
in a plausible band, the dollar column still the largest of the three, no jump
between two fixes that the market did not make, and the provider's own reading
matching the row it just read.

Its plausibility floor is 400 rather than 100, and a test is the reason. A
per-gram figure read as per-ounce is the true price divided by 31.1, so gold at
$4,399 arrives as $141, and a floor of 100 waved it straight through. That is
the exact mistake the provider README warns about hardest, and this checker
missed it until something checked the checker.

**Charts step, they do not curve.** Reserve figures are month-end reports. A
smooth line would imply a central bank's holding drifts continuously between
them, which is not what the data says. Gaps mean an economy did not report that
month, not that its holding fell to zero.

## Security notes

The API is small but it is still an HTTP surface, so a few things are deliberate:

- **Every query parameter is validated** by `stringParam`/`numberParam` in
  `backend/src/lib/http.js`, which reject arrays and objects rather than coerce
  them. Express parses `?kind=a&kind=b` into an array, and handlers that assumed
  a string threw a TypeError on input any client could send. `limit` is bounded
  and must be a whole number.
- **Error messages are opt-in, not opt-out.** Only an `HttpError` thrown
  deliberately is returned to the client; anything else is logged and replaced.
  Unexpected errors carry absolute paths and upstream URLs, and the dataset
  loader's ENOENT was returning a full filesystem path. `err.expose` is not
  honoured either, tempting as it looks: it means "status under 500" to
  `http-errors`, and any dependency can set it on a message nothing here wrote.
- **Security headers** (`nosniff`, `DENY`, `no-referrer`, a CSP) are set on
  every response, and the framework banner is disabled. The CSP differs by
  surface, as above: `default-src 'none'` for the API, the app's own policy for
  the app.
- **Provider keys stay server-side.** The frontend never calls a provider and
  never receives a key. Nothing is echoed back in an error.
- **CORS is an allowlist**, defaulting to the dev origin only.
- **Codes from the feed are looked up in Maps, not plain objects**, so a key
  like `constructor` returns nothing instead of an inherited function.
- **`npm run dev` refuses to start on a busy port.** The API runs under
  `node --watch`, which does not exit when its listen fails, so a stale server
  left the launcher reporting success while Vite quietly took the API's port and
  the app proxied to itself.

### Rate limiting

This is self-hosted software: you run your own copy, and the only client is
normally your own browser. The limits are sized for that, and exist to catch two
things rather than to fend off the internet:

- a runaway loop in the frontend firing requests without end
- accidental exposure, since `vite --host` is one flag away from putting the dev
  server on your network

Three buckets, because the endpoints do not cost the same thing:

| Bucket | Limit | Why |
|---|---|---|
| general (`/api/*`) | 600/min | Browsing five pages uses 15 |
| `/api/price/history` | 45/min | `?range=max` is **694 kB** for a 67 byte request, 83 kB compressed. This is what actually caps egress |
| `/api/health` | 1200/min | A monitor polls it; throttling it would fake an outage |

Limits are sized against measured behaviour, not guessed. A cold Compare load
with six countries fires **10 requests inside a millisecond**: the price, the
freshness check, the dataset metadata, the country list, and one per economy.
React StrictMode doubles that to 20 in development. So a short window, or a
limit in the low tens, would reject the app's own normal traffic. A test
replays that doubled burst and asserts none of it is rejected.

Browsing five pages, one of them that Compare, is 15 requests in total. The
600 limit is forty times that, which is the point: it is there to stop a loop,
not to ration a reader.

The history bucket is sized against the **uncompressed** figure, which is
deliberate. Compression is something the caller asks for: `Accept-Encoding:
identity` and the 694 kB arrives whole. A browser gets 83 kB, an adversary
chooses, and a limit is worth sizing against the choice it does not control. So
45/min is 31 MB a minute at worst and 3.8 at best.

The buckets are separate on purpose: exhausting the history limit leaves the
price headline and the reserves table working, and only the chart card errors.

#### One bucket for everyone, and when that happens

Limits key on the client IP. Two situations:

- **Self-hosted, nothing in front.** Every request genuinely comes from one
  machine, so one bucket is one user. Correct, and nothing to configure.
- **Behind a reverse proxy with `TRUST_PROXY` unset.** Every request arrives
  wearing the proxy's address, so all your users collapse into a single bucket
  and the limits become a global cap. Under real traffic that throttles
  everybody at once.

**There is no automatic fix for this, and that is deliberate.** The app could
notice a forwarded header and start trusting it, but trusting the header because
the header is present is exactly the bug it would be papering over: anyone can
send one, and doing so would hand every caller an unlimited bypass. Only the
operator knows whether a proxy is genuinely in front. So it is configuration,
and the software's job is to make the requirement impossible to miss:

- the API prints how the limits behave on **every** start, in both directions
- `warnIfProxied` logs once, loudly, the moment a forwarded header actually
  arrives while `TRUST_PROXY` is off, which is when the caveat stops being
  hypothetical

Set `TRUST_PROXY` to a hop count (`1`), an address, or `loopback` when deploying
behind a proxy. Never `true`, which trusts any hop. `false`, `off`, `no`, `0` and
an empty value all mean off, and unset is off.

Those spellings are handled explicitly because environment variables are
strings and Express reads a bare string as an IP allowlist: `TRUST_PROXY=false`
used to throw "invalid IP address" and kill the process at startup, and
`TRUST_PROXY=1` was accepted while trusting nothing, since hop counts have to be
numbers. Tests pin both.

The limiter store is in memory and per process, so running more than one
instance gives each its own buckets. That needs a shared store.

`npm audit` is clean in both packages. `qs` is pinned via an override above what
express asks for, and `react-router-dom` sits past the open-redirect advisory.

## Licence

The code is MIT, in [LICENSE](LICENSE).

That covers the code only. The reserve figures in
`backend/data/gold-reserves.json` are derived from IMF data, which carries its
own terms, and the bundled typeface is under the SIL Open Font License.
[NOTICE.md](NOTICE.md) records each of them with the source's own wording, so
if you redistribute this or publish figures from it, read that first. No
interpretation of the IMF's terms is offered here.

## Not investment advice

This is a data viewer. It shows what central banks reported to the IMF and what
an ounce of gold sold for at a London auction. Nothing here is a
recommendation, and neither dataset is complete.
