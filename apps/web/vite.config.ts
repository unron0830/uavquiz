import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const base = (process.env.BASE_PATH ?? '').replace(/\/$/, '');
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@uqa/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts') } },
  server: {
    port: 5173,
    proxy: { '/api.ashx': 'http://localhost:8097', '/images': 'http://localhost:8097' },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
