import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useDebounced } from '../lib/useDebounced.js';
import { ReservesTable } from '../components/ReservesTable.jsx';
import { Card, Spinner, ErrorNote } from '../components/Ui.jsx';

export function Countries() {
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [includeNonCountries, setIncludeNonCountries] = useState(false);
  const [selected, setSelected] = useState([]);
  const navigate = useNavigate();

  // The field stays fully controlled so typing feels immediate; only the
  // request waits for the typing to settle.
  const debouncedSearch = useDebounced(search, 200);

  const meta = useAsync(() => api.reservesMeta(), []);
  const list = useAsync(
    () =>
      api.reserves({
        search: debouncedSearch,
        region,
        kind: includeNonCountries ? 'all' : 'country',
      }),
    [debouncedSearch, region, includeNonCountries],
  );

  const toggle = (code) =>
    setSelected((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));

  return (
    <div className="space-y-6">
      <Card
        titleAs="h1"
        title="Reporting economies"
        subtitle={
          list.data ? `${list.data.total} of ${meta.data?.entryCount ?? '--'} rows shown` : undefined
        }
        right={
          selected.length >= 2 && (
            <button
              type="button"
              onClick={() => navigate(`/compare?codes=${selected.join(',')}`)}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-strong"
            >
              Compare {selected.length} selected
            </button>
          )
        }
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[14rem]">
            <span className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">
              Search by name, code or region
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. Switzerland, CHE, Europe"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">Region</span>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">All regions</option>
              {(meta.data?.regions ?? []).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 pb-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--c-accent)]"
              checked={includeNonCountries}
              onChange={(e) => setIncludeNonCountries(e.target.checked)}
            />
            Include aggregates and institutions
          </label>
        </div>

        {selected.length === 1 && (
          <p className="mb-3 text-sm text-ink-muted">Select one more to compare.</p>
        )}

        {list.loading && <Spinner label="Loading countries" />}
        <ErrorNote error={list.error} />
        {!list.loading && !list.error && (
          <ReservesTable
            countries={list.data.countries}
            selectable
            selected={selected}
            onToggle={toggle}
          />
        )}
      </Card>
    </div>
  );
}
