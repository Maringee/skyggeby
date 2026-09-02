import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Consume the shared package straight from source so Vite type-strips it
      // itself. This keeps HMR working when shared code changes.
      '@skyggeby/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Lets the browser talk to the API on the same origin during development,
      // which keeps the session cookie simple and first-party.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
