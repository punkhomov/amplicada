import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../packages/platform-core/src/frontend'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/scheduler/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/react-router')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'vendor-charts';
          }
          if (id.includes('node_modules/cmdk') || id.includes('node_modules/@radix-ui/react-dialog')) {
            return 'vendor-ui';
          }
          if (id.includes('node_modules/@dnd-kit')) {
            return 'vendor-dnd';
          }
          if (id.includes('node_modules/embla-carousel')) {
            return 'vendor-ui';
          }
          if (id.includes('node_modules/react-day-picker') || id.includes('node_modules/date-fns')) {
            return 'vendor-date';
          }
          if (id.includes('node_modules/react-resizable-panels')) {
            return 'vendor-ui';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
