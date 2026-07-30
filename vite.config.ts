import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    hmr: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 12000, // data_pegawai ~10MB adalah static data file — suppress false alarm
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
          if (id.includes('src/data/data_lokasi')) {
            return 'data-lokasi';
          }
          if (id.includes('src/data/data_pegawai')) {
            return 'data-pegawai';
          }
        }
      }
    }
  }
});
