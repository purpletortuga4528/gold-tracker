import { config } from '../../config.js';
import { lbmaProvider } from './lbma.js';

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
 * LBMA, which is free and goes back to 1968.
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
      description: p.description,
      active: id === config.priceProvider,
    };
  });
}
