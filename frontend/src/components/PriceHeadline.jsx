import { usePrice } from '../lib/usePrice.jsx';
import { formatPrice, formatDate } from '../lib/format.js';
import { Pill, Spinner, ErrorNote } from './Ui.jsx';

/**
 * The current price, stated with its actual freshness rather than dressed up as
 * a live tick. The LBMA benchmark is a once-daily auction result; saying so is
 * the difference between an honest dashboard and a misleading one.
 */
export function PriceHeadline() {
  const { price, loading, error } = usePrice();

  if (loading) return <Spinner label="Fetching the gold price" />;
  if (error) {
    return (
      <ErrorNote
        error={error}
        hint="Is the backend running on port 5174? Start it with: npm run dev --prefix backend"
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <span className="text-5xl font-semibold tabular-nums tracking-tight">
          {formatPrice(price.priceUsdPerOunce)}
        </span>
        <span className="pb-1.5 text-sm text-ink-muted">per troy ounce</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Pill tone="gold">{price.benchmark ?? price.providerLabel}</Pill>
        <Pill>{price.kind === 'benchmark' ? 'Daily benchmark' : 'Spot'}</Pill>
        <Pill>As of {formatDate(price.asOfDate)}</Pill>
        {price.stale && <Pill tone="warn">Stale: last refresh failed</Pill>}
      </div>

      {price.note && <p className="mt-3 text-sm text-ink-muted">{price.note}</p>}

      {price.alternates && (
        <p className="mt-2 text-sm text-ink-muted">
          Same fix in other currencies:{' '}
          {Object.entries(price.alternates)
            .filter(([, v]) => Number.isFinite(v))
            .map(([code, v]) => `${code} ${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
            .join(' | ') || 'not published'}
        </p>
      )}
    </div>
  );
}
