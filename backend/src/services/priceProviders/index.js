import { config } from '../../config.js';
import { lbmaProvider } from './lbma.js';
import { createGoldApiProvider, createMetalPriceProvider } from './keyed.js';

const registry = new Map();
registry.set('lbma', () => lbmaProvider);
registry.set('goldapi', () => createGoldApiProvider({ apiKey: config.goldApiKey }));
registry.set('metalprice', () => createMetalPriceProvider({ apiKey: config.metalPriceApiKey }));

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
 * The provider used for historical series. Keyed providers meter history calls
 * per date, so charts always come from LBMA unless the selected provider both
 * supports history and is explicitly chosen for it.
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
