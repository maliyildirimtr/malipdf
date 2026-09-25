import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Export fonts must be readable without fetch() from a file:// app, so they
    // are inlined as data: URLs (see src/pdf/exportFonts.ts). Other assets keep
    // Vite's default 4 KB rule.
    assetsInlineLimit: (filePath: string) => (filePath.endsWith('.ttf') ? true : undefined),
    rollupOptions: {
      // Externalize pdfjs worker
      output: {
        manualChunks: {
          'pdfjs': ['pdfjs-dist'],
          'pdflib': ['pdf-lib'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  worker: {
    format: 'es',
  },
});
