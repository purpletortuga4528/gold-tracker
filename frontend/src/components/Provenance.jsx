import { Card, Pill } from './Ui.jsx';
import { formatDate, safeHttpUrl } from '../lib/format.js';

/**
 * Where the numbers came from and what they do not cover. This is not filler:
 * a reserves table without its coverage caveat invites people to read the
 * column total as a world figure, which it is not.
 */
export function Provenance({ meta }) {
  if (!meta) return null;
  return (
    <Card title="About this data" className="text-sm">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Reserves source</dt>
          <dd className="mt-1">
            {safeHttpUrl(meta.sourceUrl) ? (
              <a
                href={safeHttpUrl(meta.sourceUrl)}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent-strong underline underline-offset-2"
              >
                {meta.source}
              </a>
            ) : (
              <span>{meta.source}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Coverage</dt>
          <dd className="mt-1">
            {meta.countryCount} reporting economies &middot; latest figure{' '}
            {formatDate(meta.latestAsOfDate)} &middot; snapshot built{' '}
            {meta.generatedAt ? formatDate(meta.generatedAt.slice(0, 10)) : '--'}
          </dd>
        </div>
      </dl>

      <ul className="mt-4 space-y-2 text-ink-muted">
        <li>{meta.indicatorNote}</li>
        <li>{meta.valuationNote}</li>
        {meta.shareNote && <li>{meta.shareNote}</li>}
        <li>{meta.coverageNote}</li>
      </ul>

      {meta.scaleCorrections?.length > 0 && (
        <div className="mt-4 rounded-lg border border-warn-line bg-warn-bg p-3">
          <p className="font-medium text-warn-ink">
            <Pill tone="warn">unit fix</Pill> Unit errors detected in the source data
          </p>
          <p className="mt-1 text-warn-ink/80">
            Found by checking each reporter's own dollar figure against its own ounce figure, not
            from a hand-written list.
          </p>
          <ul className="mt-2 space-y-2 text-warn-ink/90">
            {meta.scaleCorrections.map((o) => (
              <li key={o.countryCode}>
                <span className="font-mono text-xs">{o.countryCode}</span>: {o.evidence}
              </li>
            ))}
          </ul>
        </div>
      )}

      {meta.quarantined?.length > 0 && (
        <div className="mt-4 rounded-lg border border-danger-line bg-danger-bg p-3">
          <p className="font-medium text-danger-ink">Excluded as implausible</p>
          <ul className="mt-2 space-y-2 text-danger-ink/90">
            {meta.quarantined.map((q) => (
              <li key={q.countryCode}>
                <span className="font-mono text-xs">{q.countryCode}</span> {q.countryName}:{' '}
                {q.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
