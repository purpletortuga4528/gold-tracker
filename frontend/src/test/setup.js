import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Each test starts from a clean document and a clean localStorage.
 *
 * The appearance code writes to both `<html>` and localStorage, so without this
 * a theme set in one test leaks into the next and the failure looks like a bug
 * in the component rather than in the harness.
 */
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-contrast');
  document.documentElement.removeAttribute('data-font');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * jsdom has no matchMedia. The appearance provider asks for it to resolve the
 * "system" theme, so a stub is needed or every render throws.
 */
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

/**
 * Recharts measures its container, and jsdom reports every element as 0x0, so
 * charts render nothing and warn about it. Giving ResponsiveContainer a size
 * keeps the console clean; no test asserts on chart internals, because a chart
 * verified in jsdom is not evidence it draws correctly in a browser.
 */
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 400 });
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/*
 * A note on hooks, because this cost real time twice.
 *
 * `beforeEach(() => someMock.mockReset())` looks harmless but returns the mock,
 * and Vitest treats a function returned from a hook as a teardown callback. So
 * the mock gets *called* after every test. When its implementation throws or
 * rejects, that surfaces as an unhandled rejection attributed to a test that
 * had already passed, or as a hook timeout in the next one.
 *
 * Always give hooks a block body.
 */
