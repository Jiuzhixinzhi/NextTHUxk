# 0002. 兼容底线：Firefox 128+ / 单 IIFE / storage 双形态

- 状态：已接受
- 日期：2026-09-17
- 相关：`manifest.json`（`strict_min_version`）· `vite.content.config.ts`（单 IIFE content script）· `src/lib/storage/store.ts`

## 背景

扩展为 Manifest V3，需同时运行于 Chrome 与 Firefox；技术栈含 Tailwind CSS 4 与 Svelte 5 runes，构建由 Vite 完成。

## 决策

1. **Firefox 128+**：`manifest.gecko.strict_min_version` 不低于 128（Tailwind 4 的 CSS 基线与所需 WebExtension API）。
2. **无 ES module content script**：content script 打包为单一 IIFE，全部 JS+CSS 内联注入 Shadow DOM（`src/content/main.ts`）。
3. **storage 双形态**：`chrome.storage` 等 API 须同时兼容 Chrome callback 与 Firefox Promise 形态，统一经 `NX.store`（`storage/store.ts`）封装，不在业务代码直连。
4. **构建产物不提交**：`dist/`、`node_modules/` 已 gitignore；发布由 tag 触发的 CI 构建。

## 后果

- 不得为「更现代的写法」引入 ES module content script、Promise-only storage 调用或 Firefox 128 以下才需要的 polyfill。
- 新增 storage 键统一在 `storage/store.ts` 的 `K` 表登记，并经封装读写。
