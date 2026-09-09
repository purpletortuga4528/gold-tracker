import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ReservesTable } from './ReservesTable.jsx';

const PRICE = { priceUsdPerOunce: 4402.55, benchmark: 'LBMA Gold Price PM', asOfDate: '2026-09-07' };

vi.mock('../lib/usePrice.jsx', () => ({
  usePrice: () => ({ price: PRICE, loading: false, error: null }),
}));

const COUNTRIES = [
  {
    countryCode: 'USA',
    countryName: 'United States',
    kind: 'country',
    region: 'Americas',
    reserveTonnes: 8133.53,
    asOfDate: '2026-07-31',
    nonGoldReservesUsd: 241_667_033_000,
    unitScaleApplied: null,
  },
  {
    countryCode: 'CHN',
    countryName: 'China',
    kind: 'country',
    region: 'Asia',
    reserveTonnes: 2366.35,
    asOfDate: '2026-07-31',
    nonGoldReservesUsd: 3_650_000_000_000,
    unitScaleApplied: null,
  },
  {
    countryCode: 'BRA',
    countryName: 'Brazil',
    kind: 'country',
    region: 'Americas',
    reserveTonnes: 172.45,
    asOfDate: '2026-07-31',
    nonGoldReservesUsd: 347_320_000_000,
    unitScaleApplied: { divisor: 1000, evidence: 'implies $4.04 per ounce, 1000x below market' },
  },
  {
    countryCode: 'PRT',
    countryName: 'Portugal',
    kind: 'country',
    region: 'Europe',
    reserveTonnes: 382.7,
    asOfDate: '2026-07-31',
    // Roughly 80 percent of Portugal's reserves are gold, on a sixth of the
    // tonnage China holds. This is what the share column exists to surface.
    nonGoldReservesUsd: 13_289_373_336,
    unitScaleApplied: null,
  },
  {
    countryCode: 'SGP',
    countryName: 'Singapore',
    kind: 'country',
    region: 'Asia',
    reserveTonnes: 203.54,
    asOfDate: '2026-07-31',
    // Reports no total reserves, so no share can be computed.
    nonGoldReservesUsd: null,
    unitScaleApplied: null,
  },
];

const show = (props = {}) =>
  render(
    <MemoryRouter>
      <ReservesTable countries={COUNTRIES} {...props} />
    </MemoryRouter>,
  );

/** Country names in the order they are rendered. */
const orderedNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1].textContent.replace(/unit fix|country/g, '').trim());

const headerButton = (label) => screen.getByRole('button', { name: new RegExp(label) });

describe('rendering', () => {
  test('shows tonnes, a computed value, and a computed share', () => {
    show();
    const usa = screen.getByRole('row', { name: /United States/ });
    expect(within(usa).getByText('8,133.5 t')).toBeInTheDocument();
    expect(within(usa).getByText('$1.15T')).toBeInTheDocument();
    // Restated at market, not the IMF's own ratio, which would say 4 percent.
    expect(within(usa).getByText('82.7%')).toBeInTheDocument();
  });

  test('says n/a when an economy does not report total reserves', () => {
    // Rather than 0 percent, which would read as "holds no gold worth counting".
    show();
    const sgp = screen.getByRole('row', { name: /Singapore/ });
    expect(within(sgp).getByText('n/a')).toBeInTheDocument();
  });

  test('flags a row whose figure was unit corrected, with the arithmetic on hover', () => {
    show();
    const bra = screen.getByRole('row', { name: /Brazil/ });
    const pill = within(bra).getByText('unit fix');
    expect(pill).toBeInTheDocument();
    expect(pill.closest('[title]')).toHaveAttribute('title', expect.stringContaining('1000x below market'));
  });

  test('every country links to its detail page', () => {
    show();
    expect(screen.getByRole('link', { name: 'United States' })).toHaveAttribute('href', '/countries/USA');
  });

  test('says so plainly when there is nothing to show', () => {
    render(
      <MemoryRouter>
        <ReservesTable countries={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No countries match/)).toBeInTheDocument();
  });
});

describe('sorting', () => {
  test('defaults to tonnes, largest first', () => {
    show();
    expect(orderedNames()).toEqual(['United States', 'China', 'Portugal', 'Singapore', 'Brazil']);
  });

  test('a second click reverses the direction', async () => {
    show();
    await userEvent.click(headerButton('Tonnes'));
    expect(orderedNames()).toEqual(['Brazil', 'Singapore', 'Portugal', 'China', 'United States']);
  });

  test('sorts by name as text, not by number', async () => {
    show();
    await userEvent.click(headerButton('Country'));
    expect(orderedNames()).toEqual(['United States', 'Singapore', 'Portugal', 'China', 'Brazil']);
    await userEvent.click(headerButton('Country'));
    expect(orderedNames()).toEqual(['Brazil', 'China', 'Portugal', 'Singapore', 'United States']);
  });

  test('sorting by share reorders against tonnage, which is the point of the column', async () => {
    // Portugal holds about a sixth of China's gold and ranks below it by
    // tonnes, but four fifths of its reserves are gold against China's eight
    // percent, so by share it ranks above. A column that merely reordered the
    // same way as tonnes would not be worth having.
    show();
    expect(orderedNames().indexOf('Portugal')).toBeGreaterThan(orderedNames().indexOf('China'));

    await userEvent.click(headerButton('Share of reserves'));
    const byShare = orderedNames();
    expect(byShare[0]).toBe('United States');
    expect(byShare.indexOf('Portugal')).toBeLessThan(byShare.indexOf('China'));
  });

  test('a missing share sorts last rather than as zero', async () => {
    show();
    await userEvent.click(headerButton('Share of reserves'));
    expect(orderedNames().at(-1)).toBe('Singapore');
  });

  test('the rank column is deliberately not sortable', () => {
    show();
    const headers = screen.getAllByRole('columnheader');
    expect(within(headers[0]).queryByRole('button')).toBeNull();
  });

  test('the sorted column is announced to assistive technology', async () => {
    show();
    const tonnes = screen.getByRole('columnheader', { name: /Tonnes/ });
    expect(tonnes).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(headerButton('Tonnes'));
    expect(tonnes).toHaveAttribute('aria-sort', 'ascending');
  });
});

describe('selection', () => {
  test('checkboxes appear only when the table is selectable', () => {
    show();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    cleanupAndShowSelectable();
    expect(screen.getAllByRole('checkbox')).toHaveLength(COUNTRIES.length);
  });

  function cleanupAndShowSelectable() {
    show({ selectable: true, selected: [], onToggle: () => {} });
  }

  test('toggling reports the country code', async () => {
    const onToggle = vi.fn();
    show({ selectable: true, selected: [], onToggle });
    await userEvent.click(screen.getByRole('checkbox', { name: /Compare United States/ }));
    expect(onToggle).toHaveBeenCalledWith('USA');
  });

  test('a selected row is checked', () => {
    show({ selectable: true, selected: ['CHN'], onToggle: () => {} });
    expect(screen.getByRole('checkbox', { name: /Compare China/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Compare United States/ })).not.toBeChecked();
  });
});
