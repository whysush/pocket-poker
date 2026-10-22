import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the same build works on GitHub Pages (/pocket-poker/) and inside the Android app.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
