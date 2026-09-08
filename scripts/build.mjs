// 发布构建编排：content IIFE → popup ESM → 复制 manifest.json + icons 到 dist
import { spawn } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}: ${args.join(' ')}`))));
  });
}

function copyStatics() {
  for (const src of ['manifest.json']) {
    copyFileSync(join(root, src), join(root, 'dist', src));
  }
  const iconsFrom = join(root, 'icons');
  const iconsTo = join(root, 'dist', 'icons');
  if (existsSync(iconsFrom)) {
    mkdirSync(iconsTo, { recursive: true });
    cpSync(iconsFrom, iconsTo, { recursive: true });
  }
  // popup HTML 入口可能残留 dist/src 旧文件
  const stale = join(root, 'dist', 'src');
  if (existsSync(stale)) rmSync(stale, { recursive: true, force: true });
  console.log('[build] copied manifest.json + icons → dist');
}

if (process.argv.includes('--dev-copy')) {
  console.log('[build] dev 产物已就绪：dist-dev/content.js（配合 manifest.json 加载调试）');
  copyFileSync(join(root, 'manifest.json'), join(root, 'dist-dev', 'manifest.json'));
  const iconsFrom = join(root, 'icons');
  if (existsSync(iconsFrom)) {
    mkdirSync(join(root, 'dist-dev', 'icons'), { recursive: true });
    cpSync(iconsFrom, join(root, 'dist-dev', 'icons'), { recursive: true });
  }
  console.log('[build] dev-copy done → dist-dev/');
} else if (watch) {
  const p1 = run(['vite', 'build', '--config', 'vite.content.config.ts', '--watch']);
  const p2 = run(['vite', 'build', '--config', 'vite.popup.config.ts', '--watch']);
  copyStatics();
  await Promise.allSettled([p1, p2]);
} else {
  await run(['vite', 'build', '--config', 'vite.content.config.ts']);
  await run(['vite', 'build', '--config', 'vite.popup.config.ts']);
  copyStatics();
  console.log('[build] done → dist/');
}
