import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Countries } from './Countries.jsx';
import { api } from '../lib/api.js';

vi.mock('../lib/usePrice.jsx', () => ({
  usePrice: () => ({
    price: { priceUsdPerOunce: 4402.55, benchmark: 'LBMA Gold Price PM', asOfDate: '2026-09-07' },
    loading: false,
    error: null,
  }),
}));

vi.mock('../lib/api.js', () => ({
  api: { reserves: vi.fn(), reservesMeta: vi.fn() },
}));

const row = (code, name, region, tonnes) => ({
  countryCode: code,
  countryName: name,
  kind: 'country',
  region,
  reserveTonnes: tonnes,
  asOfDate: '2026-07-31',
  nonGoldReservesUsd: 200_000_000_000,
  unitScaleApplied: null,
});

const ALL = [
  row('USA', 'United States', 'Americas', 8133.53),
  row('CHE', 'Switzerland', 'Europe', 1039.94),
  row('CHN', 'China', 'Asia', 2366.35),
];

beforeEach(() => {
  api.reservesMeta.mockResolvedValue({ regions: ['Africa', 'Americas', 'Asia', 'Europe'], entryCount: 87 });
  api.reserves.mockResolvedValue({ countries: ALL, total: ALL.length, meta: {} });
});

const show = () =>
  render(
    <MemoryRouter initialEntries={['/countries']}>
      <Routes>
        <Route path="/countries" element={<Countries />} />
        <Route path="/compare" element={<div>compare page</div>} />
      </Routes>
    </MemoryRouter>,
  );

/** The query object the most recent list request was made with. */
const lastQuery = () => api.reserves.mock.calls.at(-1)[0];

describe('search', () => {
  test('waits for typing to settle instead of querying per keystroke', async () => {
    // Eleven keystrokes used to mean eleven requests, the first of them 20 kB.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    show();
    await waitFor(() => expect(api.reserves).toHaveBeenCalled());
    api.reserves.mockClear();

    await user.type(screen.getByRole('searchbox'), 'Switz');
    expect(api.reserves).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    await waitFor(() => expect(api.reserves).toHaveBeenCalledTimes(1));
    expect(lastQuery().search).toBe('Switz');
    vi.useRealTimers();
  });

  test('the field stays responsive while the request waits', async () => {
    // Debouncing the request, not the input: a laggy text box would be worse
    // than a few extra requests.
    show();
    await waitFor(() => expect(api.reserves).toHaveBeenCalled());
    const box = screen.getByRole('searchbox');
    await userEvent.type(box, 'Swi');
    expect(box).toHaveValue('Swi');
  });
});

describe('filters', () => {
  test('a region applies immediately, since it is a discrete choice', async () => {
    show();
    await waitFor(() => expect(api.reserves).toHaveBeenCalled());
    api.reserves.mockClear();

    await userEvent.selectOptions(screen.getByRole('combobox'), 'Europe');
    await waitFor(() => expect(api.reserves).toHaveBeenCalled());
    expect(lastQuery().region).toBe('Europe');
  });

  test('regions come from the dataset rather than a hardcoded list', async () => {
    show();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Europe' })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Africa' })).toBeInTheDocument();
  });

  test('countries only by default, so a total is never double counted', async () => {
    show();
    await waitFor(() => expect(api.reserves).toHaveBeenCalled());
    expect(lastQuery().kind).toBe('country');

    await userEvent.click(screen.getByRole('checkbox', { name: /aggregates and institutions/i }));
    await waitFor(() => expect(lastQuery().kind).toBe('all'));
  });
});

describe('selection for comparison', () => {
  test('the compare button appears only once two are chosen', async () => {
    show();
    await waitFor(() => expect(screen.getByText('United States')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Compare/ })).toBeNull();

    await userEvent.click(screen.getByRole('checkbox', { name: /Compare United States/ }));
    expect(screen.getByText(/Select one more/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /Compare China/ }));
    expect(screen.getByRole('button', { name: /Compare 2 selected/ })).toBeInTheDocument();
  });

  test('comparing navigates with the chosen codes', async () => {
    show();
    await waitFor(() => expect(screen.getByText('United States')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('checkbox', { name: /Compare United States/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Compare China/ }));
    await userEvent.click(screen.getByRole('button', { name: /Compare 2 selected/ }));

    expect(screen.getByText('compare page')).toBeInTheDocument();
  });
});

test('an API failure is reported rather than shown as an empty list', async () => {
  api.reserves.mockRejectedValue(new Error('Too many requests. Slow down and try again shortly.'));
  show();
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(within(screen.getByRole('alert')).getByText(/Too many requests/)).toBeInTheDocument();
});
