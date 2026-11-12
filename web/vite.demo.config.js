import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build da DEMONSTRAÇÃO: um único arquivo JS (o backend roda no navegador), para publicar como página estática.
export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
  build: { outDir: 'dist-demo', emptyOutDir: true, assetsInlineLimit: 100000000, cssCodeSplit: false, chunkSizeWarningLimit: 5000, rollupOptions: { output: { inlineDynamicImports: true } } },
});
