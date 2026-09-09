import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { usePrice } from '../lib/usePrice.jsx';
import { PriceHeadline } from '../components/PriceHeadline.jsx';
import { PriceChart } from '../components/PriceChart.jsx';
import { ReservesTable } from '../components/ReservesTable.jsx';
import { Provenance } from '../components/Provenance.jsx';
import { Card, Spinner, ErrorNote } from '../components/Ui.jsx';
import { reserveValueUsd, formatTonnes, formatUsdCompact } from '../lib/format.js';

export function Dashboard() {
  const { price } = usePrice();
  const top = useAsync(() => api.reserves({ limit: 10 }), []);
  const meta = useAsync(() => api.reservesMeta(), []);

  const rows = top.data?.countries ?? [];
  const reportedTonnes = rows.reduce((sum, c) => sum + c.reserveTonnes, 0);

  return (
    <div className="space-y-6">
      <Card>
        <PriceHeadline />
      </Card>

      <PriceChart />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Top 10 holders" className="lg:col-span-2">
          {top.loading && <Spinner label="Loading reserves" />}
          <ErrorNote
            error={top.error}
            hint="If the dataset is missing, generate it with: npm run build:data --prefix backend"
          />
          {!top.loading && !top.error && <ReservesTable countries={rows} />}
          <p className="mt-4 text-sm">
            <Link to="/countries" className="text-accent-strong underline underline-offset-2">
              See all {top.data?.total ?? ''} reporting economies
            </Link>
          </p>
        </Card>

        <Card title="Top 10 combined">
          <dl className="space-y-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink/50">Gold held</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                {formatTonnes(reportedTonnes)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink/50">
                Worth at the current price
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                {price
                  ? formatUsdCompact(reserveValueUsd(reportedTonnes, price.priceUsdPerOunce))
                  : '--'}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-ink/60">
            This is the top ten only, not a world total. The dataset covers economies that report
            to the IMF, so it is not a complete picture of official gold.
          </p>
        </Card>
      </div>

      <Provenance meta={meta.data} />
    </div>
  );
}
