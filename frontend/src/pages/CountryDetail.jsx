import { Link, useParams } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { usePrice } from '../lib/usePrice.jsx';
import { Card, Spinner, ErrorNote, Pill, Delta } from '../components/Ui.jsx';
import { useChartColors } from '../lib/useTheme.jsx';
import {
  reserveValueUsd,
  goldShareOfReserves,
  formatTonnes,
  formatUsdCompact,
  formatDate,
  formatPercent,
  changeOver,
  TROY_OUNCES_PER_TONNE,
} from '../lib/format.js';

export function CountryDetail() {
  const { code } = useParams();
  const { price } = usePrice();
  const { data, loading, error } = useAsync(() => api.reserve(code), [code]);
  const c = useChartColors();

  if (loading) return <Spinner label="Loading country" />;
  if (error) return <ErrorNote error={error} />;

  const { country, meta } = data;
  const history = country.history ?? [];
  const change = changeOver(history, 'reserveTonnes');
  const value = price ? reserveValueUsd(country.reserveTonnes, price.priceUsdPerOunce) : null;
  const share = price
    ? goldShareOfReserves(country.reserveTonnes, price.priceUsdPerOunce, country.nonGoldReservesUsd)
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/countries" className="text-sm text-accent-strong underline underline-offset-2">
          &larr; All countries
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{country.countryName}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill>{country.countryCode}</Pill>
          {country.region && <Pill>{country.region}</Pill>}
          {country.kind !== 'country' && <Pill tone="gold">{country.kind}</Pill>}
          {country.unitScaleApplied && <Pill tone="warn">unit fix applied</Pill>}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Gold held">
          <p className="text-3xl font-semibold tabular-nums">{formatTonnes(country.reserveTonnes)}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {(country.reserveTonnes * TROY_OUNCES_PER_TONNE).toLocaleString('en-US', {
              maximumFractionDigits: 0,
            })}{' '}
            fine troy ounces
          </p>
          <p className="mt-2 text-sm text-ink-muted">As of {formatDate(country.asOfDate)}</p>
        </Card>

        <Card title="Value at the current price">
          <p className="text-3xl font-semibold tabular-nums">{formatUsdCompact(value)}</p>
          <p className="mt-2 text-sm text-ink-muted">
            {price
              ? `Tonnes x ${price.benchmark ?? price.providerLabel} of ${formatDate(price.asOfDate)}`
              : 'Price unavailable'}
          </p>
        </Card>

        <Card title="Share of total reserves">
          {share === null ? (
            <>
              <p className="text-3xl font-semibold text-ink-subtle">n/a</p>
              <p className="mt-2 text-sm text-ink-muted">
                This economy does not report total reserve assets alongside its gold.
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-semibold tabular-nums">{formatPercent(share)}</p>
              <p className="mt-2 text-sm text-ink-muted">
                Gold at market over gold plus {formatUsdCompact(country.nonGoldReservesUsd)} of
                non-gold reserves, reported {formatDate(country.reservesAsOfDate)}. Moves with the
                gold price.
              </p>
            </>
          )}
        </Card>

        <Card title={`Change since ${formatDate(history[0]?.asOfDate)}`}>
          <p className="text-3xl font-semibold tabular-nums">
            <Delta fraction={change} />
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            {history.length} monthly observations reported to the IMF.
          </p>
        </Card>
      </div>

      {country.unitScaleApplied && (
        <div className="rounded-lg border border-warn-line bg-warn-bg p-4 text-sm text-warn-ink">
          <p className="font-medium">A unit correction was applied to this reporter</p>
          <p className="mt-1">{country.unitScaleApplied.evidence}</p>
          <p className="mt-2 text-warn-ink/70">
            Detected by comparing this economy's own reported dollar value against its own reported
            ounces, not taken from a hand-written list.
          </p>
        </div>
      )}

      <Card title="Reserve history" subtitle="Tonnes held, as reported month by month">
        {history.length < 2 ? (
          <p className="py-8 text-sm text-ink-muted">
            Not enough history reported for a trend line.
          </p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
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
                  width={64}
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => v.toLocaleString('en-US')}
                />
                <Tooltip
                  formatter={(v) => [formatTonnes(v), 'Reserves']}
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
                <Line
                  type="stepAfter"
                  dataKey="reserveTonnes"
                  stroke={c.stroke}
                  strokeWidth={c.strokeWidth}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-3 text-sm text-ink-muted">
          Drawn as steps, not a smooth curve: these are month-end reported figures, and a central
          bank's holding does not drift continuously between them. Source: {meta.source}.
        </p>
      </Card>
    </div>
  );
}
