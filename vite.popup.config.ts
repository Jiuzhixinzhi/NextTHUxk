// popup 构建：普通 ESM HTML 入口（扩展页面支持 module script）。
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    svelte({
      onwarn(w, handler) {
        if (w.code?.startsWith('a11y_')) return;
        handler(w);
      },
    }),
    tailwindcss(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    minify: true,
    rollupOptions: {
      input: { popup: 'src/popup/index.html' },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'popup' ? 'popup.html' : '[name]-[hash].js'),
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
