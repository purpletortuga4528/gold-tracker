import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // jsdom, because everything worth testing here is DOM behaviour: the table
    // sorting, the theme attributes on <html>, whether a banner appears.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    restoreMocks: true,
    include: ['src/**/*.test.{js,jsx}'],
    coverage: {
      // `all` so untested files appear as 0 rather than being omitted, which
      // otherwise reports a flattering number for whatever happens to be
      // imported.
      all: true,
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/test/**', 'src/**/*.test.{js,jsx}'],
    },
  },
  server: {
    port: 5173,
    // Fail rather than fall back. Vite's default is to hop to the next free
    // port, and the next one is 5174, which is the API's. When that happened
    // the app proxied /api to itself and served HTML where JSON was expected.
    strictPort: true,
    // Everything under /api goes to the backend, so the browser never holds a
    // provider key and there is no CORS dance in development.
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
});
