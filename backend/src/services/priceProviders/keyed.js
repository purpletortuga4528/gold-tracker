/**
 * Adapters for the commercial, key-required price providers.
 *
 * ============================ READ THIS FIRST ============================
 * UNVERIFIED. The request shapes and response field names below were written
 * from each provider's public documentation as understood at the time, and
 * have NOT been exercised against a live account, because that needs a key.
 * Providers rename fields and move endpoints. Before trusting either adapter:
 *
 *   1. Put your key in backend/.env
 *   2. Run:  npm run verify:provider -- goldapi     (or metalprice)
 *
 * That script makes one real call and prints the raw response next to what the
 * adapter extracted, so you can see immediately whether the mapping holds.
 * The extractors below are deliberately written to try several plausible field
 * names and then throw a loud, specific error naming the keys they actually
 * received, rather than silently returning undefined or a wrong number.
 * ========================================================================
 */

/** Pulls the first finite positive number found at any of `paths`. */
function pick(obj, paths, label) {
  for (const path of paths) {
    const value = path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return { value: n, path };
  }
  throw new Error(
    `${label}: could not find a usable price in the response. Tried ${paths.join(', ')}. ` +
      `Top-level keys received: ${Object.keys(obj ?? {}).join(', ') || '(none)'}. ` +
      `Check the provider's current docs and update src/services/priceProviders/keyed.js.`,
  );
}

async function getJson(url, options, label) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${label}: HTTP ${res.status}, response was not JSON: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`${label}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

/**
 * GoldAPI.io. Documented as GET https://www.goldapi.io/api/XAU/USD with the key
 * in an `x-access-token` header, returning a USD-per-troy-ounce `price`.
 */
export function createGoldApiProvider({ apiKey }) {
  return {
    id: 'goldapi',
    label: 'GoldAPI.io',
    requiresKey: true,
    supportsHistory: true,
    verified: false,
    description: 'GoldAPI.io spot quote. Requires GOLDAPI_KEY. Adapter shape unverified.',

    async getSpot() {
      if (!apiKey) throw new Error('GOLDAPI_KEY is not set');
      const body = await getJson(
        'https://www.goldapi.io/api/XAU/USD',
        { headers: { 'x-access-token': apiKey, 'Content-Type': 'application/json' } },
        'GoldAPI',
      );
      const { value, path } = pick(body, ['price', 'price_gram_24k', 'ask'], 'GoldAPI');
      if (path !== 'price') {
        throw new Error(
          `GoldAPI: the "price" field was absent and the fallback "${path}" is not a per-ounce ` +
            `price, so returning it would be wrong. Update the adapter against current docs.`,
        );
      }
      return {
        priceUsdPerOunce: value,
        currency: 'USD',
        asOfDate: new Date(Number(body.timestamp) * 1000 || Date.now()).toISOString().slice(0, 10),
        timestamp: Number.isFinite(Number(body.timestamp))
          ? new Date(Number(body.timestamp) * 1000).toISOString()
          : new Date().toISOString(),
        kind: 'spot',
        provider: 'goldapi',
        providerLabel: 'GoldAPI.io',
        note: 'Adapter response mapping is unverified; run npm run verify:provider -- goldapi.',
        raw: body,
      };
    },

    async getHistory() {
      throw Object.assign(
        new Error(
          'GoldAPI historical series is not implemented. Its history endpoint is one call per ' +
            'date, which burns a free tier fast. Use PRICE_PROVIDER=lbma for charts.',
        ),
        { status: 501 },
      );
    },
  };
}

/**
 * MetalpriceAPI. Documented as GET https://api.metalpriceapi.com/v1/latest with
 * `api_key`, `base` and `currencies` query parameters. Note the inversion: with
 * base=USD the XAU rate is ounces per dollar, so the price is its reciprocal.
 * Some responses also carry a pre-inverted `USDXAU`.
 */
export function createMetalPriceProvider({ apiKey }) {
  return {
    id: 'metalprice',
    label: 'MetalpriceAPI',
    requiresKey: true,
    supportsHistory: false,
    verified: false,
    description: 'MetalpriceAPI latest quote. Requires METALPRICEAPI_KEY. Adapter shape unverified.',

    async getSpot() {
      if (!apiKey) throw new Error('METALPRICEAPI_KEY is not set');
      const url = new URL('https://api.metalpriceapi.com/v1/latest');
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('base', 'USD');
      url.searchParams.set('currencies', 'XAU');
      const body = await getJson(url, {}, 'MetalpriceAPI');

      // Prefer the already-inverted rate if present; otherwise invert XAU.
      let priceUsdPerOunce;
      try {
        priceUsdPerOunce = pick(body, ['rates.USDXAU'], 'MetalpriceAPI').value;
      } catch {
        const { value } = pick(body, ['rates.XAU'], 'MetalpriceAPI');
        priceUsdPerOunce = 1 / value;
      }

      return {
        priceUsdPerOunce,
        currency: 'USD',
        asOfDate: new Date(Number(body.timestamp) * 1000 || Date.now()).toISOString().slice(0, 10),
        timestamp: Number.isFinite(Number(body.timestamp))
          ? new Date(Number(body.timestamp) * 1000).toISOString()
          : new Date().toISOString(),
        kind: 'spot',
        provider: 'metalprice',
        providerLabel: 'MetalpriceAPI',
        note: 'Adapter response mapping is unverified; run npm run verify:provider -- metalprice.',
        raw: body,
      };
    },

    async getHistory() {
      throw Object.assign(
        new Error(
          'MetalpriceAPI historical series is not implemented here. Use PRICE_PROVIDER=lbma for charts.',
        ),
        { status: 501 },
      );
    },
  };
}
