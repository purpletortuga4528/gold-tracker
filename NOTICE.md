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

**No price data of any kind is stored in this repository.** It never was: prices
are requested when the app runs and held only in memory, and every dollar figure
in `backend/data/gold-reserves.json` is derived from the IMF's own columns, not
from any price feed. If you configure the metals.dev provider, that data arrives
under your own key and metals.dev's terms, and likewise is never written here.

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
