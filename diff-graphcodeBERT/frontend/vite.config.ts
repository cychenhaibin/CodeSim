import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    // 为浏览器环境提供 process.env，解决 @babel/types 的兼容性问题
    'process.env': {},
  },
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    },
    open: true,
    allowedHosts: ['chester-unplumed-angelic.ngrok-free.dev'],
  },
})
