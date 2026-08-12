import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        agent: new (await import('node:http')).Agent({ keepAlive: true, maxSockets: 64 }),
      },
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        agent: new (await import('node:http')).Agent({ keepAlive: true, maxSockets: 64 }),
      },
    },
  },
});