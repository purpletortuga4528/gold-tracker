# Third party data and fonts

The MIT licence in `LICENSE` covers the code in this repository. It does not,
and cannot, extend to data or fonts produced by other people. Those are listed
here with their own terms.

If you redistribute this repository, or publish figures taken from it, these
are the terms that apply to that material, not the MIT licence.

## IMF reserves data

`backend/data/gold-reserves.json` is generated from the International Monetary
Fund's International Reserves and Foreign Currency Liquidity (IRFCL) dataset,
converted from fine troy ounces to tonnes. Regenerate it with
`npm run build:data`.

The IMF's own API returns this licence string with every response, as the
dataset's `LICENSE` attribute:

> © International Monetary Fund Copyright. All Rights Reserved.
> <https://www.imf.org/external/terms.htm>

And this citation, as `SUGGESTED_CITATION`:

> International Monetary Fund. International Reserves and Foreign Currency
> Liquidity (IRFCL), <https://data.imf.org/en/datasets/IMF.STA:IRFCL>.
> Accessed on [current date].

Both strings are reproduced verbatim from the API response, not paraphrased.
The attribute names are given so that anyone can check that for themselves
against a response, and `npm run check:docs -- --live` does exactly that: if
the IMF rewords either one, this file becomes a misquote, and nothing else
here would notice.
Read the IMF's terms yourself before redistributing the data or publishing
figures derived from it. Nothing in this repository grants you any right to it,
and no reading of those terms is offered here.

Source: <https://data.imf.org/en/datasets/IMF.STA:IRFCL>

## LBMA gold price

Prices came from the London Bullion Market Association's published daily
auction results, fetched at runtime from <https://prices.lbma.org.uk>. That feed
closed in late 2026 and the benchmark now requires a licence from ICE Benchmark
Administration, whose terms govern obtaining, using and redistributing it.

**No price series is stored in this repository, and none ever was.** Prices are
requested when the app runs and held only in memory. Every dollar figure in
`backend/data/gold-reserves.json` is derived from the IMF's own columns, not
from any price feed. If you configure the metals.dev provider, that data
arrives under your own key and metals.dev's terms, and likewise is never
written here.

What is here is a single published fix, quoted as documentation and as a test
fixture, in these places:

| Where | What |
|---|---|
| `backend/data/gold-reserves.json` | `meta.unitDetection.latestReferencePriceUsdPerOunce`, one USD figure with its date, recording what the last build priced filings against |
| `README.md`, `scripts/check-price-feed.mjs` | one feed row quoted to show the shape the provider reads, carrying its USD, GBP and EUR values |
| `backend/test/price-feed.test.js` | the same row as a fixture, so the shape checker has something to check |
| `backend/data/README.md` | the same USD figure, naming the price the published share was struck at |

All of it is the PM fix of 2026-09-08. It is recorded because a figure derived
from a price is not reproducible without knowing which price, and a shape
checker needs a shape to compare against.

Separately, `backend/src/services/priceProviders/demo.js` holds fourteen
historical gold price levels, each with a date, used as anchors for the
generated series so that a chart of it has a recognisable shape. They are
widely published historical figures, such as the January 1980 peak and the
1999 low, and none is drawn from a current licensed feed. The provider's own
disclaimer states that the curve passes through real historical levels and
that no value it serves is a published price.

Its most recent anchor was until recently the real fix above, rounded, with
cross-rate multipliers taken from that day. That made the demonstration series
reproduce the benchmark to within 0.011 percent in three currencies, which is
not a demonstration series. It is now a round number, visibly its own, and a
test fails if it ever comes within two percent of the recorded reference again.

This file previously said no price data of any kind was stored, which was not
accurate, and a licensing notice that overstates its own position is worth less
than one that does not. Whether quoting individual published observations this
way is permitted is a question for IBA's terms and not one this file answers.
If you are redistributing this repository and that distinction matters to you,
read those terms. No interpretation of them is offered here.

## Atkinson Hyperlegible Next

Bundled through `@fontsource-variable/atkinson-hyperlegible-next` and served
from this application rather than a font CDN.

Licensed under the SIL Open Font License 1.1. Google Fonts credits the design
to the Braille Institute, Applied Design Works, Elliott Scott, Megan Eiswerth
and Letters From Sweden.

> Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors
> <https://github.com/googlefonts/atkinson-hyperlegible-next>

The full licence text ships with the package, under
`frontend/node_modules/@fontsource-variable/atkinson-hyperlegible-next/LICENSE`.

## Region labels

`backend/data/regions.json` is a hand-maintained mapping of country codes to
continents, following the UN M49 grouping. It is part of this repository and
covered by the MIT licence, unlike the reserve figures it sits beside.
