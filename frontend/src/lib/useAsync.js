import { useEffect, useState } from 'react';

/**
 * Runs an async function and tracks its state, discarding results from calls
 * that have been superseded. `deps` behaves like a useEffect dependency list.
 */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(fn)
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      // `?? String(error)` because a thrown non-Error has no `.message`, and an
      // undefined error reads as "no error" to every caller, which would render
      // an empty panel instead of a failure.
      .catch((error) => !cancelled && setState({ data: null, loading: false, error: error?.message ?? String(error) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
