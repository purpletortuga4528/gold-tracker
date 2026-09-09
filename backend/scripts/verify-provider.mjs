#!/usr/bin/env node
/**
 * Makes ONE real call to a price provider and prints the raw response beside
 * what the adapter extracted from it, so you can confirm the field mapping
 * before trusting the number on a dashboard.
 *
 * Usage: npm run verify:provider -- goldapi
 *        npm run verify:provider -- metalprice
 *        npm run verify:provider -- lbma
 */
import { getProvider } from '../src/services/priceProviders/index.js';

const id = process.argv[2] ?? 'lbma';

try {
  const provider = getProvider(id);
  console.log(`Provider: ${provider.label} (${provider.id})`);
  console.log(`Requires key: ${provider.requiresKey}`);
  console.log(`Marked verified: ${provider.verified !== false}\n`);

  const spot = await provider.getSpot();
  const { raw, ...extracted } = spot;

  if (raw !== undefined) {
    console.log('--- raw provider response ---');
    console.log(JSON.stringify(raw, null, 2).slice(0, 4000));
    console.log();
  }
  console.log('--- what the adapter extracted ---');
  console.log(JSON.stringify(extracted, null, 2));
  console.log();

  const price = extracted.priceUsdPerOunce;
  console.log(`Price read as USD ${price.toFixed(2)} per troy ounce.`);
  if (price < 100 || price > 100_000) {
    console.log(
      '\n!! That is outside any plausible gold price. The field mapping is almost certainly ' +
        'wrong (a per-gram figure, or an inverted rate). Fix the adapter before using it.',
    );
    process.exitCode = 1;
  } else {
    console.log('Magnitude looks like a per-ounce gold price. Sanity check it against a public quote.');
  }
} catch (err) {
  console.error(`\nFAILED: ${err.message}`);
  process.exitCode = 1;
}
