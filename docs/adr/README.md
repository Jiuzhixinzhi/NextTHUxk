# 架构决策记录（ADR）

本目录记录 NextTHUxk 已定稿、不再反复讨论的架构/领域决策。领域词以 `CONTEXT.md` 为准，硬性约束见 `AGENTS.md`。

| 编号 | 决策 |
|---|---|
| [0001](0001-week-aware-conflict.md) | 周次感知的时间冲突判定 |
| [0002](0002-compat-baseline.md) | 兼容底线：Firefox 128+ / 单 IIFE / storage 双形态 |
| [0003](0003-reviews-fail-soft.md) | THU选课社区点评全程 fail-soft |
| [0004](0004-freshness-predicate-naming.md) | 窗口新鲜度判定函数命名约定（过期 → true） |
| [0005](0005-defensive-read-storage-shape.md) | 防御读自愈的存储形状变更可豁免 DATA_VER 递增 |
