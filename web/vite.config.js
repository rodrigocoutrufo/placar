import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento, /api vai para o servidor Python (porta 8090 do preview ou 8080 do seu servidor).
const API = process.env.PLACAR_API || 'http://localhost:8090';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: API, changeOrigin: false } } },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
});
