import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: 'localhost',
    // While developing, run the game server (npm start) next to Vite; rooms and the API are proxied to it.
    proxy: {
      '/ws': { target: 'http://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000' },
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
