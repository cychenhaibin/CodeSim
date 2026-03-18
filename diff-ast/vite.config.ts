// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // 供 @babel/types 等在浏览器中使用的 Node 环境变量
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    'process': '({ env: { NODE_ENV: ' + JSON.stringify(mode === 'production' ? 'production' : 'development') + ' } })',
  },
  server: {
    port: 3000,
    open: true,
    allowedHosts: ['chester-unplumed-angelic.ngrok-free.dev'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}));