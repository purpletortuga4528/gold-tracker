# Adding a price provider

The app ships one provider, `lbma.js`, which needs no key and is verified
working. This is what a second one has to look like.

Two adapters for GoldAPI.io and MetalpriceAPI used to live here. They were
written from published documentation and never once executed, because running
them needs an account. They were labelled unverified in the code, in the API
response and in the README, and that labelling was accurate, but shipping code
nobody has ever run is not something to do in a release. They were removed
rather than left to rot. This document is what replaced them, so that adding a
provider is still a small job.

## The interface

A provider is an object. `getSpot` is required; `getHistory` is optional.

```js
export const exampleProvider = {
  id: 'example',                    // matches PRICE_PROVIDER
  label: 'Example Metals API',
  requiresKey: true,
  supportsHistory: false,           // false means charts fall back to LBMA
  verified: false,                  // until you have actually run it
  description: 'One line, shown at /api/price/providers.',

  async getSpot() {
    // Return USD per TROY OUNCE. Not per gram, not per kilo. A provider that
    // quotes per gram will be about 31 times too cheap and nothing downstream
    // will notice, because the number is still a plausible-looking float.
    return {
      priceUsdPerOunce: 4402.55,
      currency: 'USD',
      asOfDate: '2026-09-08',       // ISO date the quote belongs to
      kind: 'spot',                 // 'spot' or 'benchmark'
      provider: 'example',
      providerLabel: 'Example Metals API',
      note: 'Anything the UI should say about freshness or caveats.',
    };
  },
};
```

Register it in `index.js`:

```js
import { exampleProvider } from './example.js';
registry.set('example', () => exampleProvider);
```

Then `PRICE_PROVIDER=example`.

## What the old adapters got wrong, so you do not repeat it

**Read the units before anything else.** MetalpriceAPI returns `rates.XAU` as
ounces per dollar with `base=USD`, so the price is its reciprocal. Getting that
backwards yields about 0.00023, which is obviously wrong. Getting a per-gram
quote wrong yields a number that looks entirely reasonable, which is worse.

**Fail loudly on a shape you did not expect.** Do not reach for a fallback
field that means something different. If `price` is missing, throw and name the
keys you actually received; do not quietly return `price_gram_24k` as though it
were a per-ounce figure.

**Do not implement `getHistory` per date.** Providers that charge per call bill
one request per day of history, and the chart asks for years. Leave
`supportsHistory: false` and the app uses LBMA for charts, which is free and
goes back to 1968.

## Checking it

```bash
npm run verify:provider -- example
```

That makes one real call and prints the raw response beside what the adapter
extracted, then sanity-checks the magnitude against a plausible gold price. It
is the difference between "the code runs" and "the number means what I think".
Only set `verified: true` once you have seen that output.

## Keys stay on the server

The key is read from the environment in `config.js` and used only here. The
frontend never calls a provider and never receives a key, and nothing about the
key is echoed back in an error.
