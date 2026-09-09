// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课程卡展开状态（渐进式披露）
// 手动展开/收起覆盖表（键 = keyOf(code, seq)），会话内存态不落盘：
// 缺席键走卡片自动规则（已选/候补/冲突/开课线风险默认展开）。
// ═══════════════════════════════════════════════════════════════

export const uicards = $state({ map: {} as Record<string, boolean> });

/** 读：手动覆盖优先，否则 autoRule（在组件 $derived 内调用保持响应式） */
export function cardExpanded(key: string, auto: boolean): boolean {
  const v = uicards.map[key];
  return v === undefined ? auto : v;
}

export function toggleCard(key: string, auto: boolean): void {
  uicards.map[key] = !cardExpanded(key, auto);
}

/** 批量：对给定课班强制开/收（「全部展开/收起」，收起连冲突/已选卡也生效） */
export function setCardsExpand(keys: string[], on: boolean): void {
  for (const k of keys) uicards.map[k] = on;
}

/** 关闭工作台/换学期时清空，避免跨学期串状态 */
export function clearCardExpansions(): void {
  uicards.map = {};
}
