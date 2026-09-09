# NextTHUxk 发布说明

<!-- 发布前人工定稿：本文件是草稿，最终以 Release 说明为准（从本文件导出并润色）。 -->

## 下一版本（草案）

> **占用持久化修复 + 占用上表 + 备份 v3（概率缓存随行）**

### 缺陷修复

- **自定义占用无法持久化（根因修复）**：`addManualEvent`/`removeManualEvent` 直传 Svelte 5 `$state` Proxy 给 `chrome.storage`，序列化失败被静默吞掉——当次会话看似成功、重启即丢；现与全库惯例一致先深拷贝落盘，失败时明确 toast 提示
- **重叠课块分道宽度错乱（v2 二次遍历在 v3.0 重构时丢失）**：同日簇内首块分配 lane 时 `ends` 尚未收满，`lanes` 少记一档——首块以全宽压住后续分道；现恢复 v2 `render.js` 的二次遍历统一簇内 `lanes`（测试实锤）

### 自定义占用上表

- 占用块与课程同池渲染进课表网格：自由钟点紫色「自定义」块（原仅 chip 列表），半透明斜纹底标识；与课程重叠时**不再挤占分道**，改为全宽覆盖层叠于课块上方（不拦截课程点击，✕ 常驻右下角可直接删除），多个占用互相重叠仍自动分道
- 占用参与全部冲突检测的口径不变（草稿硬阻断、卡片冲突提示、筛选 chip）

### 备份 v3（backupVer=3）

- 导出新增概率缓存：**概率趋势历史**（`probHist`，60 窗口快照）+ **当前检查点窗口志愿缓存**（`volCache`，volMap + 院系抓取时间戳），换机不再丢趋势、免重复拉取志愿
- 导入合并策略：趋势历史同学期按窗口点合并（按 t 去重 / 同窗替换 / 超限截断，结构坏条目跳过）；志愿缓存**仅同检查点窗口**才收（跨窗口陈旧数据明确提示跳过），`depts` 时间戳只进不退
- 兼容导入 v1/2/3；`stageCart`/草稿/占用的既有合并语义不变

## v3.2.0

> **Svelte 5 全面重构落地 + 概率趋势历史 + 课程卡直接正选恢复**：原 vanilla JS + `NX.*` 命名空间一次性退役（v2.3.0 → v3.2.0 单发），叠加检查点概率走势回看与未选课班一键正选。

### 课程卡直接正选恢复

- 未选课班双按钮并存：「**选课**」主按钮（课余量阶段余量为 0 时切换为「**排队选课**」）+ 「加入草稿」次按钮（样式对齐已选分支的草稿按钮）
- 提交前 confirmDialog 确认：课名 / 课序 / 类型 / 志愿；排队态附「余量为 0，将进入候补队列」说明
- 复用现成 `submitCourse` 链路：一次性 token 链（课满二段 `saveBksKcDl` 自动入候补）+ REJECT_RE 拒绝字典 + pollUntil 轮询确认；结果走 `showXkResult` 真实反馈，随后整表刷新回填池/已选/候补
- v3.0.0 重构时预留的 `session.doSubmitCourse` 代理重新接线（域/api 层零改动）

### 概率趋势历史

- **窗口快照留档**：每次志愿数据到货（启动 / 检查点 8/12/16/20 同步 / 按需补拉）把 VolDatum 原始值按当前窗口存为一条点；同窗口后到数据覆盖修正（幂等）；保留最近 60 窗口（约 15 天），按学期隔离
- **卡片涨跌指示**：级联概率链当前选法旁显示相对上一有效窗口的 ▲/▼/– 百分点（绿升红降）
- **点击链节点看档位趋势**：级联链任意一格点击弹出概率趋势模态——该 (类型, 志愿) 档位的历史折线 + 窗口时间轴 + 当前比值，模态内可切换全部合法档位
- 仅存本地（`probHist` 键，sem + 窗口作用域），不触碰任何服务端；队列/补选阶段不记录；不递增 DATA_VER（新增键，无旧结构破坏）
- 实现：`domain/probhist.ts` 纯函数（快照/合并/伪课程重算/SVG 路径），挂点 `volCachePersist` 防抖内先快照、变化才写盘

### 大型重构（Svelte 5 + TS + Tailwind 4）

> 一次性大型重构（2026-09）：原 vanilla JS + `NX.*` 命名空间 + manifest 脚本注入顺序全部移除。

#### 架构（目标 1-3）

- **消除 god class**：`NX.state`（~40 字段）拆为按域 stores（session/search/drafts/volunteer/reviews/backup…），显式 import 依赖图；manifest 注入顺序不再是依赖契约
- **消除隐式时序依赖**：数据层不再直接调渲染函数（mergeServerRows/_volFetchNow 层间违规 10+ 处归零）；`volNeedsRefresh` 跨文件覆盖消亡（volunteer 单一实现）；`try{render()}catch` 保险（~15 处）自然消失
- **消除手动 HTML / 手动视图模型**：35 处 innerHTML 拼接 → Svelte 模板；`NX.esc` 退役；selVersion/poolVersion/invalidatePreview 缓存链 → `$derived`；预览模式「label 字符串回读」→ 显式 `previewTarget`；筛选/查询状态源不再是 DOM（`_serverSig`/query 对象全 store 化）；RENDER_CHUNK 渐进渲染退役（服务端分页 20 行/页）

#### 草稿模型（目标 5，用户定稿）

- **「暂存」概念移除**：草稿 = 可直接编辑的命名方案（至多 5 份），改动即时保存；无「保存草稿/载入暂存/导出暂存」步骤
- **活跃草稿**：唯一编辑目标；课程卡「加入草稿」并入活跃草稿（同课班去重），**不提交正选变更**，且**硬阻断新的时间冲突**（对活跃草稿 + 自定义占用区间检测，冲突时拒绝并提示课程/时段）
- 已选载入 / JSON 导入并入活跃草稿（不阻断冲突，面板/预览标红展示）；草稿预览/学分模拟/提交选课按草稿
- 卡片上保留的直接正选入口：退选 / 退队 / 志愿调整；其余变更走「提交选课」（差量：保留 X · 退 Y · 新选 Z）
- 备份 v2 = {drafts, manualEvents}；兼容导入 v1（stageCart 并入活跃草稿）
- 旧数据：DATA_VER=7 首启清理 stageCart/config/grade（升级直弃，用户定稿）

#### AI 移除（目标 6）

- 删除 AI 排课 / AI 课程搜索 / AI 配置；删除 `config`（API 配置）与 `grade`（年级，仅 AI 用）存储键；reviews 的 `_tbSnip` 一并删除；评分徽章/联想词/排序保留
- popup 标语 / manifest 描述去除 AI 字样

#### UI（目标 4）

- 液态玻璃配方迁入 Tailwind `@theme` 令牌 + 全局层；`#lg-refract` 折射滤镜单实例
- prompt()/confirm() 全部替换为玻璃模态框（重命名/新建/替换/提交确认/删除确认/学期设置）
- 全部内联样式清除；筛选栏/时间轴/联想下拉等组件化；分页条/数据不完整入口保留

#### 平台

- Firefox 兼容底线 115 → **128**（Tailwind 4 CSS 基线）
- 构建：Vite 8 + Rolldown，content 单 IIFE（MV3 无动态 import 限制）+ popup ESM；`pnpm build` 出 `dist/`（manifest + icons 拷贝）
- 质量门：`pnpm check`（svelte-check 0 error）+ `pnpm test`（vitest 全绿：时间/冲突/概率/GBK/差量/方案覆盖）；CI 增类型检查/单测步骤

### 行为保真不变量

GBK 双向契约 · 风暴护栏全规则 · 一次性 token 链 + pollUntil 不假成功 + REJECT_RE · reviews fail-soft + CC BY-NC · WebVPN 前缀 + AES-CBC（key 勿改）· 检查点 8/12/16/20 志愿窗口缓存 · knote/zyCache/外校钟点/培养方案特殊规则 · 差量提交语义。
