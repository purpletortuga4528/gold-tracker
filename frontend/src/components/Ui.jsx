export function Card({ title, subtitle, right, children, className = '' }) {
  return (
    <section
      className={`rounded-xl border border-line bg-surface p-5 shadow-sm ${className}`}
    >
      {(title || right) && (
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-ink/60">{subtitle}</p>}
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
    <div className="flex items-center gap-2 py-8 text-sm text-ink/50" role="status">
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
    neutral: 'bg-ink/5 text-ink/70',
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
  if (!Number.isFinite(fraction)) return <span className="text-ink/40">--</span>;
  const up = fraction >= 0;
  return (
    <span className={up ? 'text-positive' : 'text-negative'}>
      {up ? '+' : ''}
      {(fraction * 100).toFixed(1)}%
    </span>
  );
}
