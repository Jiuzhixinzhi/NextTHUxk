# 0004. 窗口新鲜度判定函数命名约定（过期 → true）

- 状态：已接受
- 日期：2026-09-17
- 相关：`src/lib/update/check.ts`（`volNeedsRefresh`/`volWindowStart`）· `src/lib/stores/volunteer.svelte.ts`（`VolOpts.needsRefresh`）

## 背景

志愿院系拉取以「检查点窗口」判定数据是否新鲜。v3 改写期把 v1.5.0 的正向条件 `force || !done[code] || volNeedsRefresh(done[code])` 接线成 `ts => !volNeedsRefresh(ts)` 而条件照抄正向式，导致整式取反：窗口翻转后不重拉过期院系、同窗口内反而反复重拉。该缺陷被缺行自愈的 `force=true` 路径掩盖了两个版本。

## 决策

判定函数一律命名为「过期 → true」的**正向谓词**（如 `volNeedsRefresh(ts)`），调用处直接传递该函数（`VolOpts.needsRefresh = volNeedsRefresh`）。

**禁止**再套 `ts => !volNeedsRefresh(ts)` 之类的双重否定，或在调用侧对同一谓词再做取反。

## 后果

- 语义与函数名一致，调用点无需心算否定层数。
- `tests/volunteers.test.ts` 提供 7 例守门测试锁定「过期则拉」方向。
