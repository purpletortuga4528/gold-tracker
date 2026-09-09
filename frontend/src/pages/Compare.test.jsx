import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Compare } from './Compare.jsx';
import { AppearanceProvider } from '../lib/useTheme.jsx';
import { api } from '../lib/api.js';

vi.mock('../lib/usePrice.jsx', () => ({
  usePrice: () => ({
    price: { priceUsdPerOunce: 4402.55, benchmark: 'LBMA Gold Price PM', asOfDate: '2026-09-07' },
    loading: false,
    error: null,
  }),
}));

vi.mock('../lib/api.js', () => ({
  api: { reserve: vi.fn(), reserves: vi.fn(), reservesMeta: vi.fn() },
}));

const country = (code, name, tonnes) => ({
  country: {
    countryCode: code,
    countryName: name,
    kind: 'country',
    region: 'Europe',
    reserveTonnes: tonnes,
    asOfDate: '2026-07-31',
    nonGoldReservesUsd: 200_000_000_000,
    history: [
      { asOfDate: '2010-01-31', reserveTonnes: tonnes / 2 },
      { asOfDate: '2026-07-31', reserveTonnes: tonnes },
    ],
  },
  meta: { source: 'IMF IRFCL' },
});

beforeEach(() => {
  api.reservesMeta.mockResolvedValue({ regions: ['Europe'], entryCount: 87 });
  api.reserves.mockResolvedValue({ countries: [], total: 0, meta: {} });
});

// Compare reads chart colours from the appearance context, so it needs the
// provider even though no assertion here touches a chart.
const at = (search) =>
  render(
    <AppearanceProvider>
      <MemoryRouter initialEntries={[`/compare${search}`]}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
          <Route path="/countries/:code" element={<div>detail</div>} />
        </Routes>
      </MemoryRouter>
    </AppearanceProvider>,
  );

describe('partial failures', () => {
  test('one bad code does not discard the countries that loaded', async () => {
    // Promise.all used to reject the lot, so ?codes=POL,ZZZZ,CHN rendered no
    // rows and no chart at all, throwing away two perfectly good results.
    api.reserve.mockImplementation(async (code) => {
      if (code === 'ZZZZ') throw new Error('No reserves data for that code');
      return code === 'POL' ? country('POL', 'Poland', 640.2) : country('CHN', 'China', 2366.35);
    });

    at('?codes=POL,ZZZZ,CHN');

    await waitFor(() => expect(screen.getByText('Poland')).toBeInTheDocument());
    expect(screen.getByText('China')).toBeInTheDocument();
    expect(screen.getByText(/One selection could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText(/ZZZZ/)).toBeInTheDocument();
    expect(screen.getByText(/No reserves data for that code/)).toBeInTheDocument();
  });

  test('a rate limited request loses only that country', async () => {
    // The case rate limiting made likely: a dozen parallel requests, one 429.
    api.reserve.mockImplementation(async (code) => {
      if (code === 'CHN') throw new Error('Too many requests. Slow down and try again shortly.');
      return country('POL', 'Poland', 640.2);
    });

    at('?codes=POL,CHN');

    await waitFor(() => expect(screen.getByText('Poland')).toBeInTheDocument());
    expect(screen.getByText(/Too many requests/)).toBeInTheDocument();
    expect(screen.getByText(/Everything else below loaded normally/)).toBeInTheDocument();
  });

  test('a failed selection can be removed, since it has no row to remove it from', async () => {
    // The remove buttons render from the rows that loaded, so without a control
    // in the failure panel a bad code is stuck in the URL.
    api.reserve.mockImplementation(async (code) => {
      if (code === 'ZZZZ') throw new Error('No reserves data for that code');
      return country('POL', 'Poland', 640.2);
    });

    at('?codes=POL,ZZZZ');
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeInTheDocument());

    const panel = screen.getByText(/could not be loaded/).closest('div');
    await userEvent.click(within(panel).getByRole('button', { name: 'remove' }));

    await waitFor(() => expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument());
    expect(screen.getByText('Poland')).toBeInTheDocument();
  });

  test('plural wording when several fail', async () => {
    api.reserve.mockRejectedValue(new Error('nope'));
    at('?codes=AAA,BBB');
    await waitFor(() => expect(screen.getByText(/2 selections could not be loaded/)).toBeInTheDocument());
  });
});

describe('normal use', () => {
  test('renders a row per country with tonnes and a computed value', async () => {
    api.reserve.mockImplementation(async (code) =>
      code === 'POL' ? country('POL', 'Poland', 640.2) : country('CHN', 'China', 2366.35),
    );

    at('?codes=POL,CHN');

    await waitFor(() => expect(screen.getByText('Poland')).toBeInTheDocument());
    expect(screen.getByText('640.2 t')).toBeInTheDocument();
    expect(screen.getByText('$90.62B')).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
  });

  test('invites a selection when the URL carries none', async () => {
    at('');
    await waitFor(() => expect(screen.getByText(/Nothing selected yet/)).toBeInTheDocument());
    expect(api.reserve).not.toHaveBeenCalled();
  });

  test('removing a country drops it from the URL', async () => {
    api.reserve.mockImplementation(async (code) =>
      code === 'POL' ? country('POL', 'Poland', 640.2) : country('CHN', 'China', 2366.35),
    );

    at('?codes=POL,CHN');
    await waitFor(() => expect(screen.getByText('Poland')).toBeInTheDocument());

    const polandRow = screen.getByText('Poland').closest('tr');
    await userEvent.click(within(polandRow).getByRole('button', { name: 'remove' }));

    await waitFor(() => expect(screen.queryByText('Poland')).not.toBeInTheDocument());
    expect(screen.getByText('China')).toBeInTheDocument();
  });

  test('codes are upper-cased and blanks ignored, so a hand-typed URL still works', async () => {
    api.reserve.mockResolvedValue(country('POL', 'Poland', 640.2));
    at('?codes=pol,,%20');
    await waitFor(() => expect(api.reserve).toHaveBeenCalledWith('POL'));
    expect(api.reserve).toHaveBeenCalledTimes(1);
  });
});
