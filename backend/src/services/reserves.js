import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../lib/http.js';

const DATA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/gold-reserves.json',
);

let loaded = null;

async function load() {
  if (loaded) return loaded;
  let raw;
  try {
    raw = await readFile(DATA_PATH, 'utf8');
  } catch (err) {
    // The absolute path is useful to whoever runs the server and useless to
    // anyone else, so it goes to the log and not into the response body.
    console.error(`[reserves] could not read ${DATA_PATH}:`, err);
    throw new HttpError(
      503,
      'The reserves dataset is not available. Generate it with: npm run build:data',
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[reserves] ${DATA_PATH} is not valid JSON:`, err);
    throw new HttpError(503, 'The reserves dataset is unreadable. Regenerate it with: npm run build:data');
  }
  if (!Array.isArray(parsed?.countries) || parsed.countries.length === 0) {
    console.error(`[reserves] ${DATA_PATH} contains no countries`);
    throw new HttpError(503, 'The reserves dataset is empty. Regenerate it with: npm run build:data');
  }
  const byCode = new Map(parsed.countries.map((c) => [c.countryCode, c]));
  loaded = { meta: parsed.meta, countries: parsed.countries, byCode };
  return loaded;
}

/** Everything except the per-country history, which is large and rarely needed in a list. */
const slim = ({ history, ...rest }) => rest;

/**
 * @param {{ search?: string, region?: string, kind?: string, limit?: number }} query
 */
export async function listReserves({ search, region, kind = 'country', limit } = {}) {
  const { meta, countries } = await load();
  let rows = countries;

  if (kind && kind !== 'all') {
    const kinds = new Set(kind.split(',').map((k) => k.trim()));
    rows = rows.filter((c) => kinds.has(c.kind));
  }
  if (region) {
    const wanted = region.toLowerCase();
    rows = rows.filter((c) => (c.region ?? '').toLowerCase() === wanted);
  }
  if (search) {
    const q = search.trim().toLowerCase();
    rows = rows.filter(
      (c) =>
        c.countryName.toLowerCase().includes(q) ||
        c.countryCode.toLowerCase().includes(q) ||
        (c.region ?? '').toLowerCase().includes(q),
    );
  }

  const total = rows.length;
  if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);

  return { meta, total, countries: rows.map(slim) };
}

export async function getReserve(code) {
  const { meta, byCode } = await load();
  const country = byCode.get(String(code).toUpperCase());
  if (!country) return null;
  return { meta, country };
}

export async function getReservesMeta() {
  const { meta, countries } = await load();
  const regions = [...new Set(countries.map((c) => c.region).filter(Boolean))].sort();
  return { ...meta, regions };
}

/** Used by tests and by the dev server's data-reload path. */
export function clearReservesCache() {
  loaded = null;
}
