# Gold Tracker

Central bank gold reserves by country, valued at the current gold price.

Two datasets, joined: how much gold each reporting economy holds (tonnes), and
what an ounce of gold costs (USD). Multiply them and you get what a country's
gold is worth today, which is the thing neither source gives you on its own.

**It runs with no API keys and no signup.** Both data sources are open.

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

**Node 22.12 or newer** to work on it, which is what Vitest 5 and jsdom 30
require. **The API itself runs on Node 20.6**, and CI proves that separately by
installing only the backend on 20.6 and serving real data from it. Developed on
Node 24.

```bash
npm test            # both suites: 50 backend, 117 frontend
npm run test:backend
npm run test:frontend
npm run test:coverage
npm run build       # production frontend build
npm run build:data  # refresh the reserves snapshot from the IMF
npm run check:freshness --prefix backend   # is the snapshot stale? exits 0/1/2
npm run check:docs  # do the figures quoted in these docs still match reality?
```

Every one of those runs in CI on push and pull request, plus weekly, because
two of them go stale on their own rather than when someone changes the code:
the IMF snapshot ages, and an advisory can be published against a dependency
nobody has touched.

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
quarantined rather than published.

**What this data is not:** a world total. IRFCL covers subscribers to the IMF
reserves template, so non-reporting holders and the IMF's and BIS's own gold are
absent. A footer on every page says the data is not a complete picture, and the
dashboard carries the full provenance panel spelling out that the rows must not
be summed into a world figure.

### Price: LBMA Gold Price

The London Bullion Market Association publishes its daily auction benchmark as
open JSON, in USD, GBP and EUR, back to April 1968. No key and no signup, the
full history, and it is the benchmark the market actually references. Whether
they rate limit it is not documented and has not been tested here, so the
backend caches the series rather than assuming the endpoint is free to hammer.

It is **not a live spot feed**. The auction runs twice a day, so the price you
see is the most recent published fix, tagged with its date. The app says
"daily benchmark", not "live", because it is one and not the other.

If you want intraday spot, adapters for GoldAPI.io and MetalpriceAPI are in
`backend/src/services/priceProviders/keyed.js`. Set `PRICE_PROVIDER` and the
matching key in `backend/.env` (copy `.env.example`).

> **Those two adapters are unverified.** They were written from published
> documentation and never exercised against a live account, because that needs
> an account and a key, which this project deliberately does not require. Field
> names move. Before trusting one:
>
> ```bash
> npm run verify:provider --prefix backend -- goldapi
> ```
>
> That makes one real call and prints the raw response beside what the adapter
> extracted, so you can see whether the mapping holds. The adapters throw a loud
> error naming the keys they actually received rather than returning a wrong
> number quietly.

Keys stay server side. The frontend never calls a provider and never sees a key.

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
      routes/            price and reserves HTTP routes
      services/
        priceProviders/  lbma.js (default, verified) and keyed.js (unverified)
        price.js         provider selection, caching, stale fallback
        reserves.js      dataset loading, search and filtering
      lib/
        units.js         troy ounce conversions, the one place they live
        cache.js         TTL cache with in-flight de-duplication
        http.js          query validation, HttpError, security headers
        rateLimit.js     the three buckets, and the proxy warning
      services/freshness.js  how stale the snapshot is, on two clocks
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
  scripts/
    dev.mjs              runs both servers with one Ctrl+C
    check-docs.mjs       verifies figures quoted in the docs against reality
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
inconsistently, so the IMF's own ratio puts US gold at 4 percent of US reserves
against a published figure near 84 percent. What the dataset stores is non-gold
reserves, the one quantity stable across valuation methods; the share is
restated at the live gold price and moves with it. It tracks published shares
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

The palette alone would not have been enough. Secondary text throughout is ink
at reduced opacity (`text-ink/50`), which compiles to a `color-mix` against
transparent, and pure black at 50 percent on white is `#808080`, about 3.9:1.
Explicit rules in `index.css` restore full opacity to those utilities under high
contrast. Add a new opacity step in a component and it needs adding there too.

**The tests cover behaviour, not lines.** 167 of them: 50 backend, 117 frontend.
The frontend suite covers 86 percent of statements with `coverage.all` enabled,
so untested files count as zero rather than being left out of the report. What
is deliberately not covered is `App.jsx`, `Dashboard.jsx` and `PriceChart.jsx`:
routing, composition, and a Recharts component whose drawing jsdom cannot
meaningfully verify. A chart that passes in jsdom is not evidence it renders.

**Contrast is measured, not eyeballed.** The check walks every rendered text
element and computes the real ratio against its resolved background. Sampled on
`/countries`, the densest page, which renders every row; the element count is
lower on other pages:

| Mode | Bar | Worst measured | Failing |
|---|---|---|---|
| light / normal | AA 4.5 | 5.37 | 0 of 622 |
| light / high | AAA 7.0 | 11.52 | 0 of 622 |
| dark / normal | AA 4.5 | 6.45 | 0 of 622 |
| dark / high | AAA 7.0 | 15.37 | 0 of 622 |

Two real defects came out of running it. The light accent was darkened from
`#a37814` to `#8a6412`, because white button labels on the original measured
4.00:1. And the "unit fix" pill rendered black on black in light high contrast,
a ratio of exactly 1.00, because its background token becomes ink there; it is
now an outlined chip. Neither was visible by eye against the surrounding design.

Measure on a real page load, not by flipping `data-theme` in the console and
reading `getComputedStyle` straight after. Doing the latter returns styles the
browser has not recalculated, which reports confident nonsense.

**Atkinson Hyperlegible Next is self-hosted**, via
`@fontsource-variable/atkinson-hyperlegible-next` (OFL-1.1), not loaded from a
font CDN, so the app works offline and no request about the reader leaves the
machine. Google Fonts credits it to the Braille Institute, Applied Design Works,
Elliott Scott, Megan Eiswerth and Letters From Sweden; it is the 2024 second
version of Atkinson Hyperlegible, whose letterforms are drawn so that easily
confused characters stay distinct. Table cells are `whitespace-nowrap`: the face is wider than the system
stack, and without it rows wrap instead of the table scrolling.

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

If the app has not been built, the API says so on a plain page pointing at
`npm run build`, rather than serving a broken page or a bare 404.

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
  loader's ENOENT was returning a full filesystem path.
- **Security headers** (`nosniff`, `DENY`, `no-referrer`, a `default-src 'none'`
  CSP) are set on every response, and the framework banner is disabled.
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
| general (`/api/*`) | 600/min | Browsing five pages uses about 55 |
| `/api/price/history` | 45/min | `?range=max` returns **694 kB** from a 60 byte request. This is what actually caps egress |
| `/api/health` | 1200/min | A monitor polls it; throttling it would fake an outage |

Limits are sized against measured behaviour, not guessed. One Compare page load
with six countries fires **20 requests in 0.03 seconds**, and React StrictMode
doubles that in development, so a short window or a limit in the low tens would
reject the app's own normal traffic. A test replays that exact burst and asserts
none of it is rejected.

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
