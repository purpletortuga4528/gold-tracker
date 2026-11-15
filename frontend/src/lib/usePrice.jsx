import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const PriceContext = createContext({ price: null, loading: true, error: null });

/**
 * One shared price for the whole app. Every USD figure on every page is
 * derived from this single number, so a table and a detail page can never
 * disagree about what a country's gold is worth.
 *
 * Not "spot": what arrives may be a once-daily auction benchmark, and the
 * response says which. Calling it spot here would be the same overclaim the
 * price pill is careful to avoid.
 */
export function PriceProvider({ children }) {
  const [state, setState] = useState({ price: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    api
      .currentPrice()
      .then((price) => !cancelled && setState({ price, loading: false, error: null }))
      .catch((error) => !cancelled && setState({ price: null, loading: false, error: error.message }));
    return () => {
      cancelled = true;
    };
  }, []);

  return <PriceContext.Provider value={state}>{children}</PriceContext.Provider>;
}

export const usePrice = () => useContext(PriceContext);
