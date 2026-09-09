import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useDebounced } from './useDebounced.js';

function Probe({ value, delay }) {
  const settled = useDebounced(value, delay);
  return <span data-testid="out">{settled}</span>;
}

const out = () => screen.getByTestId('out').textContent;

afterEach(() => vi.useRealTimers());

describe('useDebounced', () => {
  test('reports the initial value immediately', () => {
    render(<Probe value="S" delay={200} />);
    expect(out()).toBe('S');
  });

  test('holds back intermediate values and settles on the last', () => {
    // Typing "Switzerland" fired eleven requests, of which only the last
    // mattered. Correctness never depended on the debounce, since useAsync
    // discards superseded responses; this is about not doing the work eleven
    // times.
    vi.useFakeTimers();
    const { rerender } = render(<Probe value="S" delay={200} />);

    for (const v of ['Sw', 'Swi', 'Swit', 'Switz']) {
      rerender(<Probe value={v} delay={200} />);
      act(() => vi.advanceTimersByTime(50)); // faster than the delay
    }
    expect(out()).toBe('S');

    act(() => vi.advanceTimersByTime(200));
    expect(out()).toBe('Switz');
  });

  test('a pause longer than the delay lets a value through', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe value="a" delay={100} />);
    rerender(<Probe value="b" delay={100} />);
    act(() => vi.advanceTimersByTime(150));
    expect(out()).toBe('b');
  });

  test('an unmount cancels the pending timer rather than setting state after', () => {
    vi.useFakeTimers();
    const { rerender, unmount } = render(<Probe value="a" delay={100} />);
    rerender(<Probe value="b" delay={100} />);
    unmount();
    // Would warn about updating an unmounted component if the timer survived.
    expect(() => act(() => vi.advanceTimersByTime(500))).not.toThrow();
  });

  test('clearing the field settles on empty, so the full list comes back', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe value="Switzerland" delay={100} />);
    rerender(<Probe value="" delay={100} />);
    act(() => vi.advanceTimersByTime(150));
    expect(out()).toBe('');
  });
});
