import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePrice } from '../lib/usePrice.jsx';
import {
  reserveValueUsd,
  goldShareOfReserves,
  formatTonnes,
  formatUsdCompact,
  formatDate,
  formatPercent,
} from '../lib/format.js';
import { Pill } from './Ui.jsx';

const COLUMNS = [
  { key: 'rank', label: '#', align: 'right', sortable: false },
  { key: 'countryName', label: 'Country', align: 'left', sortable: true },
  { key: 'region', label: 'Region', align: 'left', sortable: true },
  { key: 'reserveTonnes', label: 'Tonnes', align: 'right', sortable: true },
  { key: 'valueUsd', label: 'Value at current price', align: 'right', sortable: true },
  { key: 'shareOfReserves', label: 'Share of reserves', align: 'right', sortable: true },
  { key: 'asOfDate', label: 'As of', align: 'left', sortable: true },
];

export function ReservesTable({ countries, selectable, selected, onToggle }) {
  const { price } = usePrice();
  const [sort, setSort] = useState({ key: 'reserveTonnes', dir: 'desc' });

  const rows = useMemo(() => {
    const withValue = countries.map((c, i) => ({
      ...c,
      rank: i + 1,
      valueUsd: price ? reserveValueUsd(c.reserveTonnes, price.priceUsdPerOunce) : null,
      shareOfReserves: price
        ? goldShareOfReserves(c.reserveTonnes, price.priceUsdPerOunce, c.nonGoldReservesUsd)
        : null,
    }));
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...withValue].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return typeof x === 'number' ? (x - y) * dir : String(x).localeCompare(String(y)) * dir;
    });
  }, [countries, price, sort]);

  const toggleSort = (key) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  if (countries.length === 0) {
    return <p className="py-8 text-sm text-ink-muted">No countries match that filter.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="w-full min-w-[58rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
            {/* Holds the selection checkboxes. An empty header cell leaves the
                column unnamed in a screen reader's table summary, so it is
                named here and hidden visually. */}
            {selectable && (
              <th className="w-8 px-2 py-2">
                <span className="sr-only">Select for comparison</span>
              </th>
            )}
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={`whitespace-nowrap px-3 py-2 font-medium ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                aria-sort={
                  sort.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
              >
                {col.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-ink"
                  >
                    {col.label}
                    <span aria-hidden="true" className="text-[0.65rem]">
                      {sort.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.countryCode} className="border-b border-line-soft hover:bg-raised/60">
              {selectable && (
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--c-accent)]"
                    checked={selected?.includes(c.countryCode) ?? false}
                    onChange={() => onToggle?.(c.countryCode)}
                    aria-label={`Compare ${c.countryName}`}
                  />
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-subtle">{c.rank}</td>
              <td className="whitespace-nowrap px-3 py-2">
                <Link
                  to={`/countries/${c.countryCode}`}
                  className="font-medium text-ink hover:text-accent-strong hover:underline"
                >
                  {c.countryName}
                </Link>
                {c.kind !== 'country' && (
                  <span className="ml-2">
                    <Pill>{c.kind}</Pill>
                  </span>
                )}
                {c.unitScaleApplied && (
                  /* The evidence is in an sr-only span as well as the title,
                     because a title on a non-focusable span is reachable only
                     by hovering a mouse over it. It was the only place the
                     arithmetic appeared in this table, so for anyone reading
                     by keyboard or screen reader the pill said that a figure
                     had been altered and gave no way to find out how. */
                  <span
                    className="ml-2"
                    title={`Unit correction: ${c.unitScaleApplied.evidence}`}
                  >
                    <Pill tone="warn">unit fix</Pill>
                    <span className="sr-only">
                      {' '}
                      Unit correction applied. {c.unitScaleApplied.evidence}
                    </span>
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{c.region ?? '--'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatTonnes(c.reserveTonnes)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {c.valueUsd == null ? (
                  <span className="text-ink-subtle">price unavailable</span>
                ) : (
                  formatUsdCompact(c.valueUsd)
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {c.shareOfReserves == null ? (
                  <span
                    className="text-ink-subtle"
                    title="This economy does not report total reserve assets alongside its gold, so the share cannot be computed."
                  >
                    n/a
                    {/* Same reason as the unit-fix pill above: "n/a" on its own
                        reads as missing data rather than as a figure that
                        cannot be computed, and the difference was in a tooltip
                        only a mouse could reach. */}
                    <span className="sr-only">
                      {' '}
                      This economy does not report total reserve assets alongside its gold, so the
                      share cannot be computed.
                    </span>
                  </span>
                ) : (
                  formatPercent(c.shareOfReserves)
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{formatDate(c.asOfDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
