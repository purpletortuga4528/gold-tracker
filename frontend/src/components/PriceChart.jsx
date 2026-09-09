import { useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { formatPrice, formatDate, changeOver } from '../lib/format.js';
import { Card, Spinner, ErrorNote, Delta } from './Ui.jsx';
import { useChartColors } from '../lib/useTheme.jsx';

const RANGES = ['1m', '3m', '6m', '1y', '2y', '5y', '10y', 'max'];

export function PriceChart() {
  const [range, setRange] = useState('1y');
  const c = useChartColors();
  const { data, loading, error } = useAsync(() => api.priceHistory(range), [range]);

  const points = data?.points ?? [];
  const change = changeOver(points, 'priceUsdPerOunce');

  return (
    <Card
      title="Gold price"
      subtitle={data?.note}
      right={
        <div className="flex flex-wrap gap-1" role="group" aria-label="Chart time range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={r === range}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                r === range
                  ? 'bg-accent text-on-accent'
                  : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      }
    >
      {loading && <Spinner label="Loading price history" />}
      <ErrorNote error={error} />

      {!loading && !error && points.length > 0 && (
        <>
          <p className="mb-3 text-sm text-ink-muted">
            {formatDate(points[0].date)} to {formatDate(points.at(-1).date)} &middot;{' '}
            {points.length.toLocaleString('en-US')} auction days &middot; change{' '}
            <Delta fraction={change} />
          </p>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.fill} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={c.fill} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis
                  dataKey="date"
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
                  tickFormatter={(v) => `$${Math.round(v).toLocaleString('en-US')}`}
                />
                <Tooltip
                  formatter={(v) => [formatPrice(v), 'LBMA PM fix']}
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
                <Area
                  type="monotone"
                  dataKey="priceUsdPerOunce"
                  stroke={c.stroke}
                  strokeWidth={c.strokeWidth}
                  fill="url(#goldFill)"
                  fillOpacity={c.areaFillOpacity}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {!loading && !error && points.length === 0 && (
        <p className="py-8 text-sm text-ink-muted">No price points in this range.</p>
      )}
    </Card>
  );
}
