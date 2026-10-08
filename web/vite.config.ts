import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const server = process.env.SERVER_URL ?? 'http://localhost:5050';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
      '/api': server,
    },
  },
  build: {
    chunkSizeWarningLimit: 700, // three.js is most of the bundle
    rollupOptions: {
      // Two pages: the laptop app and the phone's selfie page.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        selfie: fileURLToPath(new URL('./selfie.html', import.meta.url)),
      },
    },
  },
});
