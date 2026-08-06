import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  esbuild: { charset: 'ascii' },
  build: {
    outDir: 'dist-prototype',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'prototype.html',
      output: { inlineDynamicImports: true, entryFileNames: 'p.js', assetFileNames: 'p.[ext]' },
    },
  },
});
