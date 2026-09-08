// content script 构建：单文件 IIFE（MV3 content script 禁 dynamic import；
// 全部 JS/CSS 打包进 content.js，CSS 以 ?inline 字符串注入 Shadow DOM）。
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const dev = mode === 'development';
  return {
    plugins: [
      svelte({
        compilerOptions: { dev },
        onwarn(w, handler) {
          if (w.code?.startsWith('a11y_')) return;
          handler(w);
        },
      }),
      tailwindcss(),
    ],
    build: {
      outDir: dev ? 'dist-dev' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      minify: !dev,
      sourcemap: dev,
      lib: {
        entry: 'src/content/main.ts',
        formats: ['iife'],
        name: 'NextTHUxkContent',
        fileName: () => 'content.js',
      },
    },
  };
});
