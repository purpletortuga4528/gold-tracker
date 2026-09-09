import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
