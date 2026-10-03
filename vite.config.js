import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite runs in middleware mode inside server.js (no separate dev server needed).
// The public/ folder is served at root — sw.js and manifest.json live there.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
