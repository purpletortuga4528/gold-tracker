/**
 * @param {object} props
 * @param {'h1'|'h2'|'h3'} [props.titleAs] Heading level for `title`. Defaults to
 *   h2, because most cards sit under a page heading. The card that leads a page
 *   passes h1: a page with no level-one heading gives a screen reader nothing to
 *   orient by, and three of these four pages had none.
 */
export function Card({ title, subtitle, right, children, className = '', titleAs: Heading = 'h2' }) {
  return (
    <section
      className={`rounded-xl border border-line bg-surface p-5 shadow-sm ${className}`}
    >
      {(title || right) && (
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {title && <Heading className="text-lg font-semibold tracking-tight">{title}</Heading>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-ink-muted" role="status">
      <span className="h-3 w-3 animate-pulse rounded-full bg-accent" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorNote({ error, hint }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-danger-line bg-danger-bg p-4 text-sm text-danger-ink" role="alert">
      <p className="font-medium">Could not load this.</p>
      <p className="mt-1 font-mono text-xs break-words">{error}</p>
      {hint && <p className="mt-2 text-danger-ink/80">{hint}</p>}
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-ink/5 text-ink-muted',
    gold: 'bg-accent-soft text-accent-strong',
    warn: 'bg-warn-line text-warn-ink',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Delta({ fraction }) {
  if (!Number.isFinite(fraction)) return <span className="text-ink-subtle">--</span>;
  const up = fraction >= 0;
  return (
    <span className={up ? 'text-positive' : 'text-negative'}>
      {up ? '+' : ''}
      {(fraction * 100).toFixed(1)}%
    </span>
  );
}
