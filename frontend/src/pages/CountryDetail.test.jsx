import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CountryDetail } from './CountryDetail.jsx';
import { AppearanceProvider } from '../lib/useTheme.jsx';
import { api } from '../lib/api.js';

vi.mock('../lib/usePrice.jsx', () => ({
  usePrice: () => ({
    price: { priceUsdPerOunce: 4402.55, benchmark: 'LBMA Gold Price PM', asOfDate: '2026-09-07' },
    loading: false,
    error: null,
  }),
}));

vi.mock('../lib/api.js', () => ({ api: { reserve: vi.fn() } }));

const POLAND = {
  country: {
    countryCode: 'POL',
    countryName: 'Poland, Republic of',
    kind: 'country',
    region: 'Europe',
    reserveTonnes: 640.2,
    asOfDate: '2026-07-31',
    nonGoldReservesUsd: 216_450_000_000,
    reservesAsOfDate: '2026-07-31',
    unitScaleApplied: null,
    history: [
      { asOfDate: '2010-01-31', reserveTonnes: 102.9 },
      { asOfDate: '2026-07-31', reserveTonnes: 640.2 },
    ],
  },
  meta: { source: 'International Monetary Fund, IRFCL' },
};

const at = (code) =>
  render(
    <AppearanceProvider>
      <MemoryRouter initialEntries={[`/countries/${code}`]}>
        <Routes>
          <Route path="/countries/:code" element={<CountryDetail />} />
          <Route path="/countries" element={<div>list</div>} />
        </Routes>
      </MemoryRouter>
    </AppearanceProvider>,
  );

beforeEach(() => {
  api.reserve.mockReset();
});

describe('the figures', () => {
  test('shows tonnes, ounces, a market value and a computed share', async () => {
    api.reserve.mockResolvedValue(POLAND);
    at('POL');

    await waitFor(() => expect(screen.getByText('640.2 t')).toBeInTheDocument());
    expect(screen.getByText(/20,582,908 fine troy ounces/)).toBeInTheDocument();
    expect(screen.getByText('$90.62B')).toBeInTheDocument();
    expect(screen.getByText('29.5%')).toBeInTheDocument();
  });

  test('attributes the value to the benchmark it used', async () => {
    api.reserve.mockResolvedValue(POLAND);
    at('POL');
    await waitFor(() => expect(screen.getByText(/LBMA Gold Price PM of 7 Sept 2026/)).toBeInTheDocument());
  });

  test('reports change against the first reported figure, not an assumed zero', async () => {
    api.reserve.mockResolvedValue(POLAND);
    at('POL');
    // 102.9 t to 640.2 t is a rise of 522.2 percent.
    await waitFor(() => expect(screen.getByText('+522.2%')).toBeInTheDocument());
  });

  test('says n/a for share when the economy reports no total reserves', async () => {
    api.reserve.mockResolvedValue({
      ...POLAND,
      country: { ...POLAND.country, nonGoldReservesUsd: null },
    });
    at('POL');
    await waitFor(() => expect(screen.getByText('n/a')).toBeInTheDocument());
    expect(screen.getByText(/does not report total reserve assets/)).toBeInTheDocument();
  });
});

describe('corrected figures are disclosed on the page, not just in the data', () => {
  test('shows the arithmetic when a unit correction was applied', async () => {
    api.reserve.mockResolvedValue({
      ...POLAND,
      country: {
        ...POLAND.country,
        countryName: 'Brazil',
        reserveTonnes: 172.45,
        unitScaleApplied: {
          divisor: 1000,
          evidence: "This reporter's own dollar figure implies $4.0434 per ounce, 1000x below the market price.",
        },
      },
    });
    at('BRA');

    await waitFor(() => expect(screen.getByText(/A unit correction was applied/)).toBeInTheDocument());
    expect(screen.getByText(/1000x below the market price/)).toBeInTheDocument();
    expect(screen.getByText('unit fix applied')).toBeInTheDocument();
  });

  test('shows no such notice for an uncorrected country', async () => {
    api.reserve.mockResolvedValue(POLAND);
    at('POL');
    await waitFor(() => expect(screen.getByText('640.2 t')).toBeInTheDocument());
    expect(screen.queryByText(/A unit correction was applied/)).toBeNull();
  });
});

describe('history', () => {
  test('explains that gaps are non-reporting, not a holding of zero', async () => {
    api.reserve.mockResolvedValue(POLAND);
    at('POL');
    await waitFor(() => expect(screen.getByText(/Drawn as steps/)).toBeInTheDocument());
    expect(screen.getByText(/does not drift continuously/)).toBeInTheDocument();
  });

  test('says so rather than drawing a line through a single point', async () => {
    api.reserve.mockResolvedValue({
      ...POLAND,
      country: { ...POLAND.country, history: [{ asOfDate: '2026-07-31', reserveTonnes: 640.2 }] },
    });
    at('POL');
    await waitFor(() => expect(screen.getByText(/Not enough history/)).toBeInTheDocument());
  });
});

test('an unknown code reports the error instead of rendering an empty page', async () => {
  api.reserve.mockImplementation(async () => {
    throw new Error('No reserves data for that code');
  });
  at('ZZZZ');
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.getByText(/No reserves data for that code/)).toBeInTheDocument();
});
