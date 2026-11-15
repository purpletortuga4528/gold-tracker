# Adding a price provider

The app ships three providers:

- `lbma.js`, which needs no key and was verified working, until LBMA closed the
  feed in late 2026. It is kept for whoever can still reach it.
- `metalsdev.js`, which republishes the LBMA fix and needs a free key. Written
  from documentation and **never run**, so it is marked unverified.
- `demo.js`, which generates prices for demonstrations and says so in every
  field that reaches the UI. Never a default.

This is what a fourth has to look like.

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
  supportsHistory: false,           // false falls back to lbma.js, which is shut
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

**Read the units before anything else, and read them from a real response.**
Metals APIs disagree about what they return: per troy ounce, per gram, per
kilo, or a rate expressed as metal per unit of currency, which is the
reciprocal of a price. The MetalpriceAPI adapter was written against a
published description of the last of those and never run, so whether it had it
right was never established, which is the reason it is not here.

Two of those mistakes announce themselves and one does not. Inverting a rate
gives about 0.00023 instead of about 4,400, and a per-kilo figure is off by a
factor of 32. A per-gram figure is off by 31.1 and still looks like a plausible
number, so nothing downstream flinches. Check the magnitude against a public
quote before you believe any of them.

**Fail loudly on a shape you did not expect.** Do not reach for a fallback
field that means something different. If the field you want is missing, throw
and name the keys you actually received. A response that also carries a
per-gram or per-karat figure makes this tempting and makes it worse: falling
back to one of those returns a number, in the right type, in the right range,
that is silently wrong by a factor of 31 or more.

**Do not implement `getHistory` per date.** Providers that charge per call bill
one request per day of history, and the chart asks for years.

This used to say: leave `supportsHistory: false` and the app uses LBMA for
charts, which is free and goes back to 1968. That advice is dead. LBMA is the
fallback in `getHistoryProvider()` and the fallback now always fails, so
`supportsHistory: false` means no chart at all rather than a free one. If your
provider can serve a range in one request, implement `getHistory` and say so.
If it can only be billed per day, leave the flag false and accept that the
chart card will show the fallback's error, which is honest and is all that is
left.

## Checking it

```bash
npm run verify:provider -- example
```

That makes one real call and prints the raw response beside what the adapter
extracted, then sanity-checks the magnitude against a plausible gold price. It
is the difference between "the code runs" and "the number means what I think".
Only set `verified: true` once you have seen that output.

## Keys stay on the server

`metalsdev.js` is the pattern to copy. Its key is read once in `config.js`
(`metalsDevKey`, from `METALS_DEV_API_KEY`) and used only in this directory. Do
the same: read it from `process.env` in `config.js`, never anywhere else. It
must never reach a `VITE_` variable, because everything under that prefix is
compiled into the bundle the browser downloads.

metals.dev passes its key as a query parameter rather than a header, which is
why that adapter never logs a URL. If yours does the same, keep the URL out of
every log line and every thrown error.

The frontend never calls a provider directly, so it has no reason to hold a
key. Keep it that way, and keep the key out of thrown errors: a provider's own
error message often quotes the request URL, which is where the key would be.
`price.js` already logs the upstream message and returns a fixed string in its
place, which is what stops that.
