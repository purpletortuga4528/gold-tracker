import { usePrice } from '../lib/usePrice.jsx';
import {
  formatPrice,
  formatDate,
  formatUsdCompact,
  reserveValueUsd,
  TROY_OUNCES_PER_TONNE,
} from '../lib/format.js';
import { Pill, Spinner, ErrorNote } from './Ui.jsx';

/**
 * A round number, chosen to be obviously not a quote.
 *
 * The point of the panel below is to show what the dollar columns would do
 * once a provider is configured, for a reader who has only ever seen them
 * empty. It must not do that by quoting a real price: the benchmark is
 * licensed, which is the whole reason those columns are empty. So the example
 * is explicitly hypothetical and says so twice.
 */
const EXAMPLE_PRICE_USD = 4000;

/** What the value columns would show, worked through on one tonne. */
function WorkedExample() {
  const perTonne = reserveValueUsd(1, EXAMPLE_PRICE_USD);

  return (
    <div className="mt-4 rounded-lg border border-line bg-raised p-3 text-sm text-ink-muted">
      <p className="font-medium text-ink">What a price would give you</p>
      <p className="mt-1">
        A tonne is {TROY_OUNCES_PER_TONNE.toLocaleString('en-US', { maximumFractionDigits: 4 })} fine
        troy ounces. So at a hypothetical {formatPrice(EXAMPLE_PRICE_USD)} an ounce, one tonne of
        gold is worth about {formatUsdCompact(perTonne)}, and the dollar column below would fill in
        at that rate for every holding on the page.
      </p>
      <p className="mt-2 text-ink-subtle">
        That figure is an illustration, not a quote: it uses a round number precisely because the
        real benchmark is the thing this app cannot reach. Configure a provider and every dollar
        value and share of reserves is computed from the real one instead.
      </p>
    </div>
  );
}

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
      <div>
        <ErrorNote
          error={error}
          hint={
            'The reserve figures below do not depend on this, so tonnages are still right. ' +
            'Only the dollar values and the share of reserves need a price.'
          }
        />
        <WorkedExample />
      </div>
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
        <Pill tone={price.synthetic ? 'warn' : 'gold'}>
          {price.benchmark ?? price.providerLabel}
        </Pill>
        {/* A generated price must never be labelled "Spot", which is the most
            misleading word available for it. The warn tone is the same one
            staleness uses: something here needs reading before believing. */}
        <Pill tone={price.synthetic ? 'warn' : 'neutral'}>
          {price.synthetic ? 'Not a real price' : price.kind === 'benchmark' ? 'Daily benchmark' : 'Spot'}
        </Pill>
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
