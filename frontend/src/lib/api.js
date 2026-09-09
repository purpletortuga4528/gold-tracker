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
  const res = await fetch(url);
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
