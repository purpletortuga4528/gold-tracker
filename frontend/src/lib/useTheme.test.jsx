import { describe, expect, test, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AppearanceProvider,
  useAppearance,
  useChartColors,
  THEME_KEY,
  FONT_KEY,
  CONTRAST_KEY,
} from './useTheme.jsx';

const html = () => document.documentElement;

/** Replaces matchMedia so the "system" theme can be pointed either way. */
function stubSystemDark(dark) {
  const listeners = new Set();
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: dark,
    media: query,
    addEventListener: (_e, fn) => listeners.add(fn),
    removeEventListener: (_e, fn) => listeners.delete(fn),
    dispatchEvent: () => false,
  }));
  return {
    /** Fires an OS-level theme change at whatever is listening. */
    change: (nowDark) => act(() => listeners.forEach((fn) => fn({ matches: nowDark }))),
  };
}

function Probe() {
  const { theme, resolvedTheme, contrast, font, setTheme, setContrast, setFont } = useAppearance();
  return (
    <div>
      <span data-testid="state">{`${theme}/${resolvedTheme}/${contrast}/${font}`}</span>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('system')}>system</button>
      <button onClick={() => setContrast('high')}>high</button>
      <button onClick={() => setFont('hyperlegible')}>hyperlegible</button>
    </div>
  );
}

const renderProbe = () => render(<AppearanceProvider><Probe /></AppearanceProvider>);
const state = () => screen.getByTestId('state').textContent;

describe('appearance state', () => {
  test('defaults to system, and resolves it against the OS', () => {
    stubSystemDark(true);
    renderProbe();
    expect(state()).toBe('system/dark/normal/default');
    expect(html().dataset.theme).toBe('dark');
  });

  test('only the resolved theme reaches the DOM, never the word "system"', () => {
    // The stylesheet has no prefers-color-scheme query, so an unresolved value
    // on <html> would match no palette at all.
    stubSystemDark(false);
    renderProbe();
    expect(html().dataset.theme).toBe('light');
    expect(html().dataset.theme).not.toBe('system');
  });

  test('an explicit choice overrides the OS', async () => {
    stubSystemDark(true);
    renderProbe();
    await userEvent.click(screen.getByText('light'));
    expect(state()).toBe('light/light/normal/default');
    expect(html().dataset.theme).toBe('light');
  });

  test('following the OS resumes when the choice goes back to system', async () => {
    const media = stubSystemDark(false);
    renderProbe();
    await userEvent.click(screen.getByText('dark'));
    expect(html().dataset.theme).toBe('dark');

    await userEvent.click(screen.getByText('system'));
    expect(html().dataset.theme).toBe('light');

    media.change(true);
    expect(html().dataset.theme).toBe('dark');
  });

  test('contrast and font are independent of theme', async () => {
    // High contrast dark has to be reachable: needing high contrast and
    // preferring a dark ground are different needs.
    stubSystemDark(false);
    renderProbe();
    await userEvent.click(screen.getByText('dark'));
    await userEvent.click(screen.getByText('high'));
    await userEvent.click(screen.getByText('hyperlegible'));

    expect(state()).toBe('dark/dark/high/hyperlegible');
    expect(html().dataset.theme).toBe('dark');
    expect(html().dataset.contrast).toBe('high');
    expect(html().dataset.font).toBe('hyperlegible');
  });
});

describe('persistence', () => {
  test('choices are written under the keys the boot script reads', async () => {
    stubSystemDark(false);
    renderProbe();
    await userEvent.click(screen.getByText('dark'));
    await userEvent.click(screen.getByText('high'));
    await userEvent.click(screen.getByText('hyperlegible'));

    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(localStorage.getItem(CONTRAST_KEY)).toBe('high');
    expect(localStorage.getItem(FONT_KEY)).toBe('hyperlegible');
  });

  test('stored choices are restored', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    localStorage.setItem(CONTRAST_KEY, 'high');
    localStorage.setItem(FONT_KEY, 'hyperlegible');
    stubSystemDark(false);
    renderProbe();
    expect(state()).toBe('dark/dark/high/hyperlegible');
  });

  test('a junk stored value falls back instead of reaching the DOM', () => {
    // Stored data is not trusted input. A hand-edited or stale value would
    // otherwise be written onto <html>, matching no palette.
    localStorage.setItem(THEME_KEY, 'chartreuse');
    localStorage.setItem(CONTRAST_KEY, 'extreme');
    localStorage.setItem(FONT_KEY, 'comic-sans');
    stubSystemDark(false);
    renderProbe();
    expect(state()).toBe('system/light/normal/default');
  });

  test('survives localStorage throwing, as it does in some privacy modes', async () => {
    stubSystemDark(false);
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => renderProbe()).not.toThrow();
    expect(state()).toBe('system/light/normal/default');
    // The choice must still apply for this session even if it cannot be saved.
    await userEvent.click(screen.getByText('dark'));
    expect(html().dataset.theme).toBe('dark');

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe('useChartColors', () => {
  function ColorProbe() {
    const c = useChartColors();
    return <span data-testid="chart">{`${c.highContrast}/${c.strokeWidth}/${c.areaFillOpacity}`}</span>;
  }

  test('drops the gradient and thickens the stroke in high contrast', async () => {
    // A soft gradient under the line is exactly the low-contrast detail being
    // switched off, so the line has to carry the chart on its own.
    stubSystemDark(false);
    render(
      <AppearanceProvider>
        <Probe />
        <ColorProbe />
      </AppearanceProvider>,
    );
    expect(screen.getByTestId('chart').textContent).toBe('false/1.8/1');

    await userEvent.click(screen.getByText('high'));
    expect(screen.getByTestId('chart').textContent).toBe('true/3/0');
  });
});

test('useAppearance refuses to be used outside its provider', () => {
  // The throw is the assertion, so React's error logging and jsdom's uncaught
  // error report are both expected noise. Suppressed so that anything printed
  // by this suite is a genuine problem.
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  const swallow = (event) => event.preventDefault();
  window.addEventListener('error', swallow);
  try {
    expect(() => render(<Probe />)).toThrow(/AppearanceProvider/);
  } finally {
    window.removeEventListener('error', swallow);
    quiet.mockRestore();
  }
});
