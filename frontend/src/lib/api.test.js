import { describe, expect, test, vi, beforeEach } from 'vitest';
import { api } from './api.js';

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

/** The URL the last call was made to. */
const calledUrl = () => new URL(fetchMock.mock.calls[0][0]);

describe('request building', () => {
  test('everything goes to our own backend, never to a provider', async () => {
    // The frontend must never hold a provider key or call one directly.
    fetchMock.mockResolvedValue(jsonResponse({ priceUsdPerOunce: 4402.55 }));
    await api.currentPrice();
    expect(calledUrl().pathname).toBe('/api/price/current');
    expect(calledUrl().origin).toBe(window.location.origin);
  });

  test('drops empty parameters instead of sending them', async () => {
    // An empty `search` would otherwise be sent and rejected by the API's
    // validator, turning "cleared the box" into an error.
    fetchMock.mockResolvedValue(jsonResponse({ countries: [] }));
    await api.reserves({ search: '', region: undefined, kind: 'country', limit: null });
    const url = calledUrl();
    expect(url.searchParams.get('kind')).toBe('country');
    expect(url.searchParams.has('search')).toBe(false);
    expect(url.searchParams.has('region')).toBe(false);
    expect(url.searchParams.has('limit')).toBe(false);
  });

  test('encodes a country code rather than splicing it into the path', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ country: {} }));
    await api.reserve('../../etc/passwd');
    expect(calledUrl().pathname).toBe('/api/reserves/..%2F..%2Fetc%2Fpasswd');
  });

  test('passes a range through', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ points: [] }));
    await api.priceHistory('5y');
    expect(calledUrl().searchParams.get('range')).toBe('5y');
  });
});

describe('error handling', () => {
  test("surfaces the API's own message, which the UI shows verbatim", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Too many requests. Slow down and try again shortly.' }, 429));
    await expect(api.reserves()).rejects.toThrow(/Too many requests/);
  });

  test('falls back to the status when there is no message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    await expect(api.reserves()).rejects.toThrow(/503/);
  });

  test('says the response was not JSON rather than throwing a parse error', async () => {
    // This is what a misconfigured proxy looks like: HTML where JSON was due.
    fetchMock.mockResolvedValue(new Response('<!doctype html><html></html>', { status: 200 }));
    await expect(api.reserves()).rejects.toThrow(/non-JSON/);
  });

  test('an API that never answered says so, and says what to do about it', async () => {
    // fetch rejects only when the request got no answer at all, so this is the
    // one place that can tell "the server is down" from "the server is up and
    // something upstream of it is down". The message has to carry that, because
    // the panel showing it cannot work it out afterwards.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.currentPrice()).rejects.toThrow(/did not answer/i);
    await expect(api.currentPrice()).rejects.toThrow(/npm start/);
  });

  test('an error the API itself reported is passed through untouched', async () => {
    // The opposite case, and the reason the two are separated. A 502 means the
    // server answered: telling someone to start it would send them to restart
    // a process that is running perfectly.
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'Could not reach the gold price provider' }, 502),
    );
    await expect(api.currentPrice()).rejects.toThrow('Could not reach the gold price provider');
    await expect(api.currentPrice()).rejects.not.toThrow(/did not answer/i);
  });

  test('a 200 with valid JSON resolves to the body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ total: 85 }));
    await expect(api.reserves()).resolves.toEqual({ total: 85 });
  });
});
