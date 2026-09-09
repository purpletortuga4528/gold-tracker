# The reserves dataset

`gold-reserves.json` is generated, not hand-written. Rebuild it with:

```
npm run build:data
```

Nothing in it is edited by hand. If a number looks wrong, fix the script or the
config beside it and regenerate.

Check how stale it is with:

```
npm run check:freshness
```

which exits 0 fresh, 1 ageing, 2 stale, so a scheduled job or CI step can fail
loudly rather than let the app serve old numbers quietly.

## Where the numbers come from

Source: IMF International Reserves and Foreign Currency Liquidity (IRFCL),
dataflow `IMF.STA,IRFCL`. Three indicators per economy:

| Indicator | What it is | What it is used for |
|---|---|---|
| `IRFCLDT1_IRFCL56V_FTO` | Gold volume, fine troy ounces | Converted to tonnes. The only figure the app displays as a holding. |
| `IRFCLDT1_IRFCL56_USD` | Gold at the reporter's own valuation | Detecting unit errors, and deriving non-gold reserves. Never displayed. |
| `IRFCLDT1_IRFCL54_USD` | Total official reserve assets | Deriving non-gold reserves. Never displayed. |

Conversion: tonnes = ounces x 31.1034768 / 1e6. The troy ounce is defined as
exactly 31.1034768 grams, so this is exact.

Sanity anchor: the United States reports 261,499,000 fine troy ounces, giving
8,133.5 t, which matches the published figure. A test asserts it. If that test
fails the conversion has broken and every dollar figure has broken with it.

## Why the dollar columns are never shown as values

Reporters value gold inconsistently. The United States carries its gold at the
statutory $42.2222 an ounce, roughly one percent of the market price. Others
carry it at market, and many at historical cost. So:

- Every dollar figure in the app is computed as **tonnes x market price**.
- Gold's share of reserves is computed as **gold at market over (gold at market
  plus non-gold reserves)**, with non-gold reserves being the one quantity that
  is stable across valuation methods.

Reading the share straight off the IMF figures gives nonsense. It puts US gold
at 4.4 percent of US reserves against a published figure of about 84 percent.
The restated calculation gives 82.6 percent at a gold price of $4,399 an ounce,
the LBMA PM fix on 2026-09-08. That figure moves with the price by design, so
it is quoted with the price it was struck at rather than as a constant.
`check:docs` recomputes both from the dataset and fails if either drifts.

When the calculation was written it was spot-checked against twelve published
shares: ten landed within three points, with the Netherlands out by 3.1 and
Turkiye by 6.8. Two cautions about that sentence. The comparison was a one-off
and no check here reproduces it, so it says nothing about today's figures. And
the list of published shares it used was not recorded, so it cannot be repeated
as it stands; the World Gold Council is the obvious place to draw a fresh one.

Exact agreement is not expected in any case, because published figures are a
different vintage from the month-end data here and are struck at a different
gold price. Treat the share as indicative rather than as a reproduction of
anyone's published number.

## Unit errors, and how they are caught

Some reporters file the gold volume line in the wrong unit. Brazil's raw figure
implies 172,446 tonnes, which would make it the largest holder on earth twenty
times over.

These are **detected from the data**, not read from a hand-written list. Two
conditions must both hold before anything is corrected:

1. **The figure is impossible as filed**, above `maxPlausibleTonnes` (9,000 t,
   just past the largest known national holding).
2. **A power of ten restores a market price**: the reporter's own dollar figure
   divided by its own ounce figure, multiplied by that power of ten, lands near
   the gold price of the month it filed.

Both conditions matter, and the first was added after the second alone produced
false positives.

Reporters that carry gold at historical cost have an implied price that drifts
as they buy at different prices, and at some point it can pass close to a power
of ten below the market price. Korea's filings imply about $172 an ounce
throughout late 2010 and the first half of 2011, when the fix ran $1,383 to
$1,536: multiply by ten and 7 of its 199 filings land inside the tolerance. A
country-wide divisor drawn from those 7 would then have been applied to the
whole series, "correcting" Korea's current 3,360,000 oz, correctly 104.5 t,
down to 336,000 oz, or 10.5 t.

Tunisia is the same class of error at a different factor. Its filings imply $12
to $15 an ounce, and 42 of its 113 matched at a factor of one hundred, across
2010 to 2013 with the fix between $1,169 and $1,814. Tunisia holds 6.8 t, which
a hundredfold correction would have reported as 0.1 t.

The sharpest case is the United States itself. It carries gold at the statutory
$42.2222 an ounce; multiply by one hundred and you get $4,222, within about five
percent of the mid-2026 market price, and 8,133.5 t divided by one hundred is
81.3 t, entirely plausible. Both of the inner conditions pass. The only thing
standing between this app and reporting that the United States holds 81 tonnes
is the check that refuses to touch a figure which is believable exactly as
filed. A test pins that.

Requiring the tonnage to be impossible first removes that entire class of error:
a believable figure is left alone whatever the reporter's valuation habits.

### The unit is a property of a filing, not of a country

Brazil filed in fine troy ounces for years and switched partway through, at
2026-03-31. Applying one divisor across the whole series divided the correct
early years by a thousand and reported Brazil as holding 0.03 t in 2010, a
574,733 percent "increase". Detection therefore runs on every filing
separately. A filing with no dollar figure to check against borrows a divisor
from its neighbours only if it is itself impossible; otherwise it is believed
as filed.

Currently corrected: **BRA** and **AGO**, both by 1000, both with the arithmetic
recorded in `meta.scaleCorrections` and shown in the app.

Anything impossible that no power of ten explains is **quarantined**: left out
of the published file entirely, with the reason in `meta.quarantined`. Nothing
unexplained is ever published as fact.

Aggregates are the exception, and have to be. The ceiling is a statement about
how much gold one country can hold, and the Euro Area row is 21 central banks
plus the ECB: it stands at 10,807 t, well past the ceiling and entirely real.
So `kind: "aggregate"` is exempt from quarantine. It is not exempt from
detection, because an aggregate can be filed in the wrong unit like anything
else; it simply loses the plausibility gate that protects the others, so an
aggregate correction should be looked at by hand before it is believed. None
is applied today.

`validation.json` holds the tunables, plus a `manualScaleOverrides` escape hatch
that is normally empty. Add an entry there only if detection cannot resolve a
country and you have a citable source.

## What this data is not

- **Not a world total.** IRFCL covers economies that subscribe to the IMF
  reserves data template. Non-reporting holders are absent, as is the gold held
  by the IMF and the BIS themselves. Summing the rows gives the sum of these
  rows and nothing more. Cross-check against the World Gold Council before
  quoting a global figure.
- **Not real time.** Figures are month-end and reported with a lag, which is
  why freshness grades the snapshot's build date and the data's own date on
  separate clocks. A snapshot built today whose newest figure is six weeks old
  is healthy; one built three months ago is not, however recent its figures
  looked at the time.

## Regions

`regions.json` is a hand-maintained continental mapping following UN M49. The
IMF dataset carries no continental grouping, and the free country-metadata API
this used to pull from (restcountries.com v3.1) has been deprecated. It affects
only the region filter.
