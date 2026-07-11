import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.VITE_DAEMON_PORT || '8888'}`,
      '/sessions': `http://127.0.0.1:${process.env.VITE_DAEMON_PORT || '8888'}`,
      '/settings': `http://127.0.0.1:${process.env.VITE_DAEMON_PORT || '8888'}`,
      '/pair': `http://127.0.0.1:${process.env.VITE_DAEMON_PORT || '8888'}`,
    },
  },
});
