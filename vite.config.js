import { defineConfig } from 'vite';

// Hosting under a sub-path (e.g. GitHub Pages: https://user.github.io/java-ide/) needs BASE_PATH=java-ide.
// It is given without slashes because Git Bash on Windows rewrites arguments that start with "/".
const basePath = (process.env.BASE_PATH ?? '').replace(/^\/+|\/+$/g, '');

export default defineConfig({
  base: basePath ? `/${basePath}/` : '/',
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
  // Vitest only runs unit tests; e2e/ is for Playwright
  test: { include: ['tests/**/*.test.js'] },
});
