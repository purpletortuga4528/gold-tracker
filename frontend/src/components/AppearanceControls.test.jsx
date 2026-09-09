import { describe, expect, test, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceControls } from './AppearanceControls.jsx';
import { AppearanceProvider, THEME_KEY, CONTRAST_KEY, FONT_KEY } from '../lib/useTheme.jsx';

const show = () =>
  render(
    <AppearanceProvider>
      <AppearanceControls />
    </AppearanceProvider>,
  );

const html = () => document.documentElement;

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
});

describe('the controls are reachable without sight or a mouse', () => {
  test('each group is labelled', () => {
    show();
    expect(screen.getByRole('group', { name: 'Colour theme' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Contrast' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Typeface' })).toBeInTheDocument();
  });

  test('every option has a text name, not just a glyph', () => {
    // The controls are drawn as symbols, so without this a screen reader
    // announces nothing usable. Names are matched exactly: "System" the theme
    // and "System typeface" are different controls, and a loose pattern
    // silently matches both.
    show();
    for (const name of ['Light', 'Dark', 'System', 'Normal contrast', 'High contrast', 'System typeface']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  test('the active option is announced as pressed', async () => {
    show();
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('the controls are operable by keyboard alone', async () => {
    show();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(html().dataset.theme).toBe('light');
  });
});

describe('each control changes what it says it does', () => {
  test('theme', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(html().dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  test('contrast, without disturbing the theme', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    await userEvent.click(screen.getByRole('button', { name: 'High contrast' }));
    expect(html().dataset.contrast).toBe('high');
    expect(html().dataset.theme).toBe('dark');
    expect(localStorage.getItem(CONTRAST_KEY)).toBe('high');
  });

  test('typeface', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: /Atkinson Hyperlegible Next/ }));
    expect(html().dataset.font).toBe('hyperlegible');
    expect(localStorage.getItem(FONT_KEY)).toBe('hyperlegible');
  });

  test('the hyperlegible option is previewed in the face it switches to', () => {
    // The control shows the change rather than only describing it.
    show();
    const preview = screen.getByText(/letterforms drawn so that easily confused/i);
    const button = preview.closest('button');
    expect(button.querySelector('[style*="Atkinson"]')).not.toBeNull();
  });
});
