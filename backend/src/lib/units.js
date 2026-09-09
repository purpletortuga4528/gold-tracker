// Weight and value conversions.
//
// The troy ounce is defined as exactly 31.1034768 grams, so the ounces-per-tonne
// figure below is exact rather than an approximation.
export const GRAMS_PER_TROY_OUNCE = 31.1034768;
export const TROY_OUNCES_PER_TONNE = 1_000_000 / GRAMS_PER_TROY_OUNCE; // 32150.7466...

export function troyOuncesToTonnes(ounces) {
  return ounces / TROY_OUNCES_PER_TONNE;
}

export function tonnesToTroyOunces(tonnes) {
  return tonnes * TROY_OUNCES_PER_TONNE;
}

/** Market value in USD of `tonnes` of gold at `pricePerOunce` USD per troy ounce. */
export function reserveValueUsd(tonnes, pricePerOunce) {
  return tonnesToTroyOunces(tonnes) * pricePerOunce;
}
