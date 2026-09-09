import { useEffect, useState } from 'react';

/**
 * Returns `value` after it has stopped changing for `delayMs`.
 *
 * The country search re-queries on every keystroke. Typing "Switzerland" fired
 * eleven requests, the first few of them large because a one or two character
 * query still matches most of the list: 20.7 kB for "S", 3.9 kB for "Sw", and
 * about 3.6 kB thereafter. Only the last of the eleven mattered.
 *
 * Correctness never depended on this, since useAsync already discards
 * superseded responses. It is purely about not doing the work eleven times.
 */
export function useDebounced(value, delayMs = 200) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return settled;
}
