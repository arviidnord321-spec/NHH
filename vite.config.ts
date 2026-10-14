import { defineConfig } from 'vite';

// Relative base so the build works from any CrazyGames/iframe sub-path.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 100000,
  },
  test: {
    environment: 'node',
  },
} as any);
