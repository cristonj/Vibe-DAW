import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Firebase and @google/genai are dynamically imported, so they split on their own.
        manualChunks: (id: string) => (id.includes('node_modules/tone') ? 'tone' : undefined),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
