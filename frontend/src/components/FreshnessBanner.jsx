import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { formatDate } from '../lib/format.js';

/**
 * Shown only when the reserves snapshot needs attention.
 *
 * The failure mode this guards against is the quiet one: the app keeps working
 * perfectly while serving figures that stopped being current months ago. Nobody
 * notices, because nothing looks broken. Saying it on the page is the point.
 */
export function FreshnessBanner() {
  const { data } = useAsync(() => api.freshness(), []);
  if (!data || data.overall === 'fresh') return null;

  const stale = data.overall === 'stale';
  const tone = stale
    ? 'border-danger-line bg-danger-bg text-danger-ink'
    : 'border-warn-line bg-warn-bg text-warn-ink';

  return (
    <div className={`rounded-lg border p-4 text-sm ${tone}`} role="status">
      <p className="font-medium">
        {stale ? 'These reserve figures are out of date' : 'These reserve figures are ageing'}
      </p>
      <p className="mt-1">
        The snapshot was built {data.snapshot.ageDays} days ago
        {data.snapshot.generatedAt && ` (${formatDate(data.snapshot.generatedAt.slice(0, 10))})`}, and
        the newest IMF figure in it is from {formatDate(data.data.latestAsOfDate)}. The IMF publishes
        monthly, so newer figures are likely available.
      </p>
      {data.action && <p className="mt-2 font-mono text-xs">{data.action}</p>}
    </div>
  );
}
