import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { usePrice } from '../lib/usePrice.jsx';
import { Card, Spinner, ErrorNote } from '../components/Ui.jsx';
import { useChartColors } from '../lib/useTheme.jsx';
import {
  reserveValueUsd,
  formatTonnes,
  formatUsdCompact,
  formatDate,
  changeOver,
} from '../lib/format.js';

export function Compare() {
  const [params, setParams] = useSearchParams();
  const codes = (params.get('codes') ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const { price } = usePrice();
  const c = useChartColors();
  const SERIES_COLORS = c.series;

  const picker = useAsync(() => api.reservesMeta(), []);
  const all = useAsync(() => api.reserves({ kind: 'all' }), []);
  /**
   * allSettled, not all. One bad code in a hand-edited URL, or a single 429 out
   * of a dozen parallel requests, used to reject the lot: `?codes=POL,ZZZZ,CHN`
   * rendered no rows and no chart, discarding the two countries that had loaded
   * perfectly well. Now whatever resolved is shown and whatever did not is named.
   */
  const details = useAsync(
    () =>
      codes.length
        ? Promise.allSettled(codes.map((c) => api.reserve(c))).then((settled) => ({
            countries: settled
              .filter((r) => r.status === 'fulfilled')
              .map((r) => r.value.country),
            failed: settled
              .map((r, i) => (r.status === 'rejected' ? { code: codes[i], reason: r.reason?.message } : null))
              .filter(Boolean),
          }))
        : Promise.resolve({ countries: [], failed: [] }),
    [params.get('codes')],
  );

  // Memoised on the fetched payload, not rebuilt each render. Without this the
  // `merged` pivot below re-ran on every render, since its only dependency was
  // an array literal that was new each time.
  const rows = useMemo(() => details.data?.countries ?? [], [details.data]);
  const failed = details.data?.failed ?? [];

  /**
   * Recharts wants one row per x value with a column per series, so the
   * per-country histories are pivoted onto a shared date axis. Countries report
   * on slightly different months, so a date missing for one country is left
   * undefined rather than zero: a gap in the line is honest, a zero is a lie.
   */
  const merged = useMemo(() => {
    const byDate = new Map();
    for (const c of rows) {
      for (const h of c.history ?? []) {
        if (!byDate.has(h.asOfDate)) byDate.set(h.asOfDate, { asOfDate: h.asOfDate });
        byDate.get(h.asOfDate)[c.countryCode] = h.reserveTonnes;
      }
    }
    return [...byDate.values()].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  }, [rows]);

  const removeCode = (code) =>
    setParams({ codes: codes.filter((c) => c !== code).join(',') }, { replace: true });

  const addCode = (code) => {
    if (!code || codes.includes(code)) return;
    setParams({ codes: [...codes, code].join(',') }, { replace: true });
  };

  return (
    <div className="space-y-6">
      <Card
        title="Compare"
        subtitle="Put reporting economies side by side"
        right={
          <select
            value=""
            onChange={(e) => addCode(e.target.value)}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
            aria-label="Add a country to the comparison"
          >
            <option value="">Add a country...</option>
            {(all.data?.countries ?? [])
              .filter((c) => !codes.includes(c.countryCode))
              .map((c) => (
                <option key={c.countryCode} value={c.countryCode}>
                  {c.countryName}
                </option>
              ))}
          </select>
        }
      >
        {codes.length === 0 && (
          <p className="py-6 text-sm text-ink/60">
            Nothing selected yet. Add one above, or tick a few rows on the{' '}
            <Link to="/countries" className="text-accent-strong underline underline-offset-2">
              countries page
            </Link>
            .
          </p>
        )}

        {details.loading && codes.length > 0 && <Spinner label="Loading selection" />}
        <ErrorNote error={details.error ?? picker.error} />

        {failed.length > 0 && (
          <div className="mb-4 rounded-lg border border-warn-line bg-warn-bg p-3 text-sm text-warn-ink">
            <p className="font-medium">
              {failed.length === 1 ? 'One selection could not be loaded' : `${failed.length} selections could not be loaded`}
            </p>
            <ul className="mt-1 space-y-1">
              {/* Each failure carries its own remove control. Without one a bad
                  code stays in the URL with no way out of the UI, because the
                  remove buttons below render only from the rows that loaded. */}
              {failed.map((f) => (
                <li key={f.code} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-mono text-xs">{f.code}</span>
                    {f.reason ? `: ${f.reason}` : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCode(f.code)}
                    className="shrink-0 text-xs underline underline-offset-2 hover:no-underline"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-warn-ink/80">Everything else below loaded normally.</p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="table-scroll">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink/50">
                  <th className="px-3 py-2 font-medium">Country</th>
                  <th className="px-3 py-2 text-right font-medium">Tonnes</th>
                  <th className="px-3 py-2 text-right font-medium">Value now</th>
                  <th className="px-3 py-2 text-right font-medium">Change over history</th>
                  <th className="px-3 py-2 font-medium">As of</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c.countryCode} className="border-b border-line-soft">
                    <td className="px-3 py-2">
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                        style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
                        aria-hidden="true"
                      />
                      <Link
                        to={`/countries/${c.countryCode}`}
                        className="font-medium hover:text-accent-strong hover:underline"
                      >
                        {c.countryName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatTonnes(c.reserveTonnes)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {price
                        ? formatUsdCompact(reserveValueUsd(c.reserveTonnes, price.priceUsdPerOunce))
                        : '--'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {(() => {
                        const ch = changeOver(c.history ?? [], 'reserveTonnes');
                        return Number.isFinite(ch) ? `${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(1)}%` : '--';
                      })()}
                    </td>
                    <td className="px-3 py-2 text-ink/50">{formatDate(c.asOfDate)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeCode(c.countryCode)}
                        className="text-xs text-ink/40 hover:text-negative"
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {merged.length > 1 && (
        <Card title="Reserves over time" subtitle="Tonnes held, month-end reported figures">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={merged} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis
                  dataKey="asOfDate"
                  tick={{ fontSize: c.tickFontSize, fill: c.axis, fontFamily: c.fontFamily }}
                  tickLine={false}
                  axisLine={{ stroke: c.grid }}
                  minTickGap={40}
                  tickFormatter={(d) => d.slice(0, 7)}
                />
                <YAxis
                  tick={{ fontSize: c.tickFontSize, fill: c.axis, fontFamily: c.fontFamily }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                  tickFormatter={(v) => v.toLocaleString('en-US')}
                />
                <Tooltip
                  formatter={(v, name) => [formatTonnes(v), name]}
                  labelFormatter={formatDate}
                  contentStyle={{
                    borderRadius: 8,
                    border: `1px solid ${c.line}`,
                    background: c.surface,
                    color: c.ink,
                    fontSize: 13,
                    fontFamily: c.fontFamily,
                  }}
                  labelStyle={{ color: c.ink }}
                  itemStyle={{ color: c.ink }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: c.ink, fontFamily: c.fontFamily }} />
                {rows.map((c, i) => (
                  <Line
                    key={c.countryCode}
                    type="stepAfter"
                    dataKey={c.countryCode}
                    name={c.countryName}
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    strokeWidth={c.strokeWidth}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-sm text-ink/50">
            Gaps mean that economy did not report that month, not that its holding fell to zero.
          </p>
        </Card>
      )}
    </div>
  );
}
