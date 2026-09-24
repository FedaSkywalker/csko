import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: 'localhost',
    // While developing, run `npx partykit dev` next to Vite; game rooms are proxied to it.
    proxy: { '/parties': { target: 'http://localhost:1999', ws: true } },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
