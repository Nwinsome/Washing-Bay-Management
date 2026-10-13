import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [react(), ...(command === 'build' ? [{
    name: 'offline-production-policy',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'self'",
      }, injectTo: 'head' as const }];
    },
  }] : [])],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
}));
