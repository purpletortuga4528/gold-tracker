/**
 * Every call goes to our own backend. The frontend never talks to a price
 * provider directly and never holds a provider key.
 */
const BASE = '/api';

async function get(path, params) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }

  // Two failures that look identical in a panel and are nothing alike: the API
  // never answered, or the API answered to say something upstream of it broke.
  // fetch only rejects for the first, so this is the one place that can tell
  // them apart, and the message has to carry the difference because the hint
  // beside it cannot guess. A static "is the backend running?" told people to
  // restart a server that was running fine.
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(
      `The API did not answer on ${window.location.host}. Is it running? Start it with: npm start`,
    );
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path}: server returned non-JSON (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(body?.error ?? `${path}: HTTP ${res.status}`);
  return body;
}

export const api = {
  currentPrice: () => get('/price/current'),
  priceHistory: (range) => get('/price/history', { range }),
  providers: () => get('/price/providers'),
  reserves: (params) => get('/reserves', params),
  reserve: (code) => get(`/reserves/${encodeURIComponent(code)}`),
  reservesMeta: () => get('/reserves/meta'),
  freshness: () => get('/reserves/freshness'),
};
