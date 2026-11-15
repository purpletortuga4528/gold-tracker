import { config } from '../../config.js';
import { lbmaProvider } from './lbma.js';
import { demoProvider } from './demo.js';
import { metalsDevProvider } from './metalsdev.js';

/*
 * One provider ships, and it is one that has actually been run.
 *
 * Adapters for GoldAPI.io and MetalpriceAPI used to sit beside this. They were
 * written from published documentation and never executed, because that needs
 * an account, and they were labelled unverified everywhere they surfaced. The
 * labelling was honest but the code was still untested, so it was removed
 * rather than released. README.md in this directory documents the interface and
 * what those adapters got wrong, so adding one remains a small job.
 */
const registry = new Map();
registry.set('lbma', () => lbmaProvider);

// The LBMA fix, republished under a licence metals.dev holds. Keyed, because
// there is no longer a free door to the benchmark: see metalsdev.js.
registry.set('metalsdev', () => metalsDevProvider);

// Generated prices, for showing the app when no real feed is reachable. Not a
// data source: see demo.js, which explains itself at length because it is the
// one thing in here capable of putting an invented number in front of someone.
// Reached only by setting PRICE_PROVIDER=demo, and never the default.
registry.set('demo', () => demoProvider);

export function getProvider(id = config.priceProvider) {
  const factory = registry.get(id);
  if (!factory) {
    throw new Error(
      `Unknown PRICE_PROVIDER "${id}". Available: ${[...registry.keys()].join(', ')}`,
    );
  }
  return factory();
}

/**
 * The provider used for historical series.
 *
 * A metered provider bills one call per day of history, and the chart asks for
 * years, so any provider that does not declare supportsHistory falls back to
 * LBMA.
 *
 * That fallback was free and went back to 1968. It is now shut, so this
 * returns a provider that will throw, and the chart card reports it. Kept
 * rather than removed: the arrangement is right the moment anyone can reach
 * the feed again, and the alternative is charging a metered provider for a
 * decade of history one day at a time.
 */
export function getHistoryProvider() {
  const selected = getProvider();
  return selected.supportsHistory ? selected : lbmaProvider;
}

export function listProviders() {
  return [...registry.entries()].map(([id, factory]) => {
    const p = factory();
    return {
      id,
      label: p.label,
      requiresKey: p.requiresKey,
      supportsHistory: p.supportsHistory,
      verified: p.verified !== false,
      // Whether its numbers are made up. Carried all the way to the UI, which
      // uses it to refuse to call a generated figure a price.
      synthetic: p.synthetic === true,
      description: p.description,
      active: id === config.priceProvider,
    };
  });
}
