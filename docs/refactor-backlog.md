# NextTHUxk 重构待办（剩余方向）

本文随 PR「架构深化批次」一并提交，供后续会话/agent 接续：含本批次已完成项、剩余候选、证据与守门约束。
术语：模块 / 接口 / 实现 / 深度 / 接缝（Seam）/ 局部性；领域词沿用 `CONTEXT.md`，硬性约束见 `AGENTS.md`。
验证命令固定：`pnpm check`（0 error）→ `pnpm test`（vitest 全绿）→ `pnpm build`。

---

## A. 本批次已完成（勿重复）

1. **线上故障热修**（`(n||[]).forEach is not a function`）
   - 崩溃点实锤：`src/lib/api/records.ts:324` `applyLevelMap` 第三参 `planData`（3.4.0 产物中混淆为 `function Lc(e,t,n){return(n||[]).forEach…}`）。
   - 根因：`src/lib/stores/session.svelte.ts` 旧 `session.planData = sd?.plan || []` 裸信任 storage——`ver` 命中但 `plan` 为真值非数组时绕过版本守卫。
   - 修法：`session.svelte.ts`（planData + manualEvents）、`src/lib/stores/drafts.svelte.ts`（drafts）三处 `Array.isArray` 归一 + 非法即清缓存重拉，`console.warn` 留诊断线索。
2. **周次感知冲突**（1-8 周与 9-16 周本不冲突）
   - `src/lib/domain/time.ts`：`WeekOcc` / `weeksOf`（单周=奇数集、双周=偶数集、多段并集、`unknown` 保守）/ `weeksOverlap` / `TimeSpan`；`spansOf` 增加 `occ`，并在无大节时兜底解析文字说明钟点（外校课入冲突与课表）。
   - `src/lib/domain/conflict.ts`：`spansIntersect` 唯一重叠判据；预览侧改为 `buildPreviewSpans` 平坦时段表（替换 `buildPreviewSlotIndex`/`PreviewHit`）；自排除按 `keyOf` 归一。
   - 调用方：`src/lib/stores/search.svelte.ts:164`、`src/content/components/CourseCard.svelte:48`。
   - `CONTEXT.md`「时间冲突」已补周次条件；`tests/domain.test.ts` +11 用例（现 141 passed）。
3. **顺手修复的同源缺陷**：自定义占用此前因槽位键不匹配在卡片徽章不可见（草稿硬阻断却可见）；外校课此前不入冲突/课表。两者现已统一命中。
4. **B6 课程卡视图模型**（`b096496`）：`domain/card-model.ts` 纯函数 `courseCardModel` 收拢容量条/开课线/中签链/涨跌/折叠行数字/冲突摘要；`session.previewConflictSpans()` 单次计算（冲突检测 O(卡数×时段) → O(时段)）；`probability.queueCapLevel/QUEUE_CAP_STYLE/queueCapTitle` 三处口径收拢；课卡 533→381 行；新增 `tests/card-model.test.ts`（17 例）。
5. **B1 课班复合键统一 keyOf**（`721bf4c`）：修两处潜伏缺陷（`resolveCourseZy` 裸键查 levelMap 丢 typeCode；`write.ts` 确认轮询裸串比较致假失败）；收编 session/records/search/volunteers/drafts/draft/probability/preview 及组件键控 each；knote 键在 load 时无损重键；删除 `rawKeyOf`/`normSeqOf`/`normSeqK` 三个拼写克隆出口。

---

## B. 剩余候选（按收益/风险排序）

### B1. 课班复合键单拼写（keyOf 全量收编）—— ✅ 已完成（`721bf4c`）
- **文件**：`src/lib/core/utils.ts` + session / drafts / search / api/records / api/volunteers / api/write / domain/preview / domain/probability / storage/knote / domain/timetable-layout。
- **问题证据**：
  - 三种拼写并存：A `keyOf`（归一）；B 手拼 `code+'_'+normSeq(seq)`（draft.ts:126/143/145/152、probability.ts:251、records.ts 多处、volunteers.ts 多处、session:217/410/444/582、drafts:294/390/407/417）；C 裸拼 `code+'_'+(seq||'0')`（search.ts:262/277 storm 去重、session:317/358/366/387/400-402/436-438/573/653/661/666、knote.ts:36、preview.ts:45、volunteers.ts:237、timetable-layout.ts:85）。
  - **潜伏实锤**：`session.svelte.ts:317` 用裸键查 `levelMap`（其键在 `records.ts:311` 归一）→ 前导零课班丢 typeCode。
  - **写确认链**：`api/write.ts:101/105/110/114/126/146` `pollUntil` 用裸串比较 → '01' vs '1' 假「未生效」（违反 AGENTS.md「不假成功」的对偶面：假失败）。
  - `volunteers.ts:237-240` 四路回退查找（两种拼写 + 行内查找 + 单行兜底）= 接缝维护税可视化。
  - `knote` 键为裸拼 → `preview.ts:44-45` 前缀扫描 + 类型谎言。
  - `utils.ts:15 rawKeyOf` 零调用，而同拼写手搓约 20 次。
  - 内联 `normSeq` 克隆：`preview.ts:87`、`volunteers.ts:232`、`timetable-layout.ts:179`。
- **深化方向**：全库统一 `keyOf`；`write.ts` 确认链归一比较；`volunteers` 建图/查询两端归一；`knote` 键迁移（需递增 `DATA_VER`）；删 `rawKeyOf` 或真正启用。
- **收益**：局部性——CONTEXT.md 已记载的 '01'/'1' bug 类收拢到一处；消灭 2 个潜伏 bug；`knote` 写入面可测。

### B2. 课程池（pool）合并单接缝 —— ✅ 已完成（`8e7a96e`）
- **文件**：`session.svelte.ts`（`mergeRows` 509-591、队列应用块 216-223 / 408-416 / 443-450）、`search.svelte.ts`（applyServerResult 三连 339-351 / 450-457 / 544-552）、`domain/preview.ts`、`api/records.ts`（`backfillCandidateMeta` 256-280）。
- **问题**：四套复制粘贴的合并习语；「借时间给未解析行」的 join 在 `previewJoinRows`（preview.ts:17-60）与 `mergeRows` borrowers（session:514-520/550-564）各写一遍，漂移即「预览有时间、池没有」；候选行 push/restamp 两处；容量刷新规则仅注释（session:537-539）。
- **深化方向**：池拥有 `applyServerResult` / `applyQueue` / `mergeCandidates` 三个操作；一个 domain join 供 preview 与 pool 共用。
- **收益**：合并策略进 vitest（现在只能靠网络 mock）；「已选X · 余Y · 排队Z」口径单一归属。

### B3. session 拆解：启动编排根 + 元数据回填引擎 + zy 解析
- **文件**：`src/lib/stores/session.svelte.ts`（777 行、~12 项职责）、`api/records.ts`。
- **问题**：`launch()`（127-307）是组合根却蹲在状态模块（还管 banner 281-289 / 更新检查 / reviews/scores 接线）；「补齐缺失元数据」引擎两份——`backfillSelTimes`（626-751，96 行，batch5 + sleep60 + `_selTried` 预算 + `_bfScanP` 扫描）vs `backfillCandidateMeta`（records.ts:256-280，runPool4 + sleep30），预算/步调互异；`resolveCourseZy`（309-381）函数中途弹 modal（控制流依赖 UI）；前台让路协议散在 `bus` / `search.withForeground` / `session.waitForegroundIdle`（636-643）/ `records` 注入的 `shouldPause`（256-261）四文件。
- **深化方向**：抽一个可注入的回填引擎（两调用方参数化预算/步调）；zy 解析独立；`launch` 退化为显式编排序列；子系统「注册进 launch + hydrate + changeSemester 重置」模式给单一归属。
- **收益**：检查点/志愿/池的生命周期改动从 4 文件编辑变 1 处；回填可注入测试。

### B4. 分页/重试词汇统一 + `pagedFetch` 完整性位
- **文件**：`src/lib/net/paged.ts`、`api/search.ts`、`api/records.ts`、`api/volunteers.ts`。
- **问题**：4 种分页方言各自手搓重试梯/去重/分页正则（`共N页` 正则 4 份：search.ts:162-165、records.ts:214/461、volunteers.ts:124/184）；`pagedFetch` 只覆盖 1 方言且返回 `T[]` 吞掉完整性（records 被迫自造 `{rows, ok}`，records.ts:190-195）；`paged.ts:77-80 diagEmpty` 在 net/ 里硬编码教务死页词表；全库 5 种熔断习语（pagedFetch / `serverSearchStorm.runPages` / `fetchQueueData` qFailStreak / volunteer `retried` / `backfillSelTimes _selTried`）0 测试。
- **深化方向**：共享分页词汇（重试梯/去重/完整性/分页解析）；`pagedFetch` 返回 items+完整性；死页分类下推到注入的 `parse`。
- **⚠ 守门**：AGENTS.md 硬性规则 3（风暴护栏数值：精确课号 1 页、≤25 全量、>25 只探 5 页、5 并发 + 30ms×槽位错峰、定向 `p_kch` ≤4 门）**只搬家不改数**；规则 4（一次性 token 链）与规则 5（不假成功 pollUntil）不得弱化。
- **收益**：一套可注入引擎覆盖 4 方言；「缺页=部分数据」不再要每个调用方自防。

### B5. 志愿检查点缓存单一 owner（volSession 回收）—— ✅ 已完成（`18f2a6e`）
> 注：`scores.ts` 的缓存对象 `S` 本就模块私有、单写者、无跨模块直改 → 不做 api→store 迁移（原诊断有误）。
- **文件**：`src/lib/api/volunteers.ts`（`volSession` 79-94 导出可变单例）、`src/lib/stores/volunteer.svelte.ts`、`session.svelte.ts:769`、`stores/backup.svelte.ts:48`；同病：`src/lib/api/scores.ts:17-72`（住 api/ 的完整缓存 store）。
- **问题**：单例被 2 层 3 模块直改（`changeSemester` 删 `depts` 键、volunteer 改 `retried`、backup 序列化内部）；预算 `3` 写了三处（volunteer:195/215 + session:583）；`nextCheckpoint` 与 `update/check.ts:57 nextVolCheckpoint` 逐字重复（volunteer:108-120）。
- **深化方向**：志愿缓存/重试预算全归 volunteer store（唯一写者），api 无状态化；scores 同治；`nextCheckpoint` 复用纯函数。
- **收益**：检查点窗口策略单一归属；换学期重置不再跨层伸手。

### B6. CourseCard 视图模型（`courseCardModel`）—— ✅ 已完成（`b096496`）
- **文件**：`src/content/components/CourseCard.svelte`（537 行）、`domain/preview.ts`、`domain/probability.ts`。
- **问题**：
  - 读 `session.isQueuePhase` 14 次（:35/86/114-126/164-173/215-228/391/415/479/496/529）；
  - **每张卡 `$derived` 重建预览时段表**（:48 `buildPreviewSpans(selectedPreviewRows()…, manualEvents)`）= O(可见卡片数) 重复计算（周次批刚让它更重）；应上移 store 级单次计算；
  - 排队/剩余展示阶梯三份抄写：`previewBlockMeta`（preview.ts:86-92 正主）、`DraftCourseRow.svelte:57-64`、`CourseCard.svelte:125-160 capText` + `:214-228 miniNum`（tooltip 字串 `已选X · 余Y · 排队Z · 容量C` 在 :132 与 :224 重复）;
  - 开课线规则是组件内纯函数（:162-174）；
  - prop-echo 手工双向同步（:26-32）；
  - 模板内部重复：prob 按钮块 ×2（:415-430 / :479-494）、选课标签 ×2（:496/529）、selected/unselected 动作行零共享、mini 分支第三份动作按钮（:503-536）。
- **深化方向**：纯 `courseCardModel(course, phase, lookups)` 吞掉阶段/队列/候补/志愿/评分 join + 冲突列表 + 动作可用性；冲突时段表上移 store 单次计算。
- **收益**：~200 行脚本进 domain 可测；模板三处重复坍缩；`CONTEXT.md` 口径规则（课余量「已选X · 余Y · 排队Z」）单一归属。

### B7. ModalHost 按类型拆解 + 确认对话统一 —— ✅ 部分完成（`12aa979`）
> 已拆 5 个业务弹窗子组件（409 → 129 行）+ `content/clipboard.ts`。
> **剩余**：`DraftPanel.svelte` 的内联导入确认仍绕过 modal 系统（应并入 `confirmDialog`）。
- **文件**：`src/content/components/modals/ModalHost.svelte`（409 行）、`src/lib/stores/modal.svelte.ts`、`src/content/components/DraftPanel.svelte`。
- **问题**：加一种 modal = 4 处编辑（`ModalState` 类型 + `openWindow` 排除 + 标题 if/else-if 链 :157-175 + 225 行 body 链 :181-405）；5 套确认实现（通用 `confirmDialog` + `zyConfirm` :341-356 + `manualCopy` :382-404 + `prompt` :365-381 + `DraftPanel.svelte:80-88` 完全绕过 modal 系统）；host 直连 reviews/scores/详情/自定义占用/剪贴板 5 子系统；clipboard 降级梯两份（`ModalHost:394-402` vs `drafts.svelte.ts:342-375`）；`ModalHost.svelte:3,4,9` 三次 import 同一 session store。
- **深化方向**：每 kind 一个子组件（`ProbTrendModal.svelte` 已证明模式且是层内最佳拆分），ModalHost 退化为遮罩+标题+注册表；定制脚注并入 `confirmDialog`；clipboard 单一 helper。
- **收益**：新 modal = 新文件；reviews fail-soft 铁律圈进自己组件；DraftPanel 导入确认进同一系统。

### B8. 单课动作 wrapper（选课/退选/退队）—— ✅ 已完成（`8b91558`）
- **文件**：`session` store + `CourseCard.svelte:247-257`、`QueuePanel.svelte:18-23`、`Timetable.svelte:67-73`。
- **问题**：退选流程抄 3 份，QueuePanel/Timetable **缺 busy 守卫**（双提交窗口）；action→toast 手工接线 9 处（`showToast(res.ok, res.msg)`）。
- **深化方向**：store 层动作内置 busy + 确认文案 + 结果 toast。
- **收益**：小改动直接修掉双提交窗口。

### B9. Storage 读接缝形状校验（热修的收拢）—— ✅ 已完成（`02e35f8`）
- **文件**：`src/lib/storage/store.ts`、`drafts.svelte.ts:96-105`、`session.svelte.ts`。
- **问题**：三处 hotfix 已就地归一，但模式仍散落；`backupImport` 对外来数据反而全有 `Array.isArray`（backup.svelte.ts:87-91）——store 自身读入不一致。另 `loadDrafts` 的 `d.courses.forEach`（drafts.svelte.ts:97）若草稿 courses 非数组仍会崩（同类不同消息）。
- **深化方向**：`store.getArray<T>(k)` 收拢「读入即校验」；`loadDrafts` 补 `Array.isArray(d.courses)`。
- **收益**：storage 坏形态故障类单一归属，未来坏数据自愈不需逐处补。

### B10. 其余零覆盖纯模块补测试（与各批并行）—— ✅ 部分完成（`0e9824e`）
> 已补：`net/decode`（decodeBest/pickDecoded/pickDecodedWithSource）· `net/paged`
> （12 例，重试/EMPTY/熔断/补抓）· `domain/preview` previewJoinRows+previewBlockMeta ·
> `net/gbk-table` 表结构守卫。fetchCandidateCourses 手搓双解码已收拢到
> pickDecodedWithSource。
> **剩余**：`records.fetchLevelTable` 的 trr1/trr2 结构启发式判据（有意保留，勿强套
> pickDecoded）；`fetchQueueData` 裸 fetch + qFailStreak 熔断（见 C 节）；
> `domain/probability` 级联边界值；`update/check` 检查点窗口边界。
- `src/lib/net/decode.ts`（`decodeBest`/`pickDecoded` 纯函数，0 测试；且 `records.ts:207-210`/`:290` 有手搓双解码竞品 → 一并收拢）；
- `src/lib/net/paged.ts`（**本就可注入** `fetchPage`/`parse`，0 测试：重试梯/EMPTY 吸收/`errStreak` 熔断/两轮降级+cooldown）；
- `domain/preview.ts previewJoinRows`（模块最难的 join 算法，0 测试）；
- gbk 表长度守卫（AGENTS.md 记载「整表错位」历史 bug，`gbk.ts:12-20` 无断言）；
- `domain/preview.ts previewBlockMeta` 的「按行而非按视图」不变量只在注释里（preview.ts:81-83）。

---

## C. 层内其它已知摩擦（小项，可顺手）

- `src/lib/stores/uicards.svelte.ts`（27 行）：map + 4 个一行函数，接口≈实现；可并入卡片视图状态。`CourseList.svelte:27` 还在直改 `uicards.map[key]`。
- `src/lib/stores/backup.svelte.ts`：非模块而是编排脚本，直改 `draftStore.drafts` / `session.manualEvents` / `probHist.map` 并绕过各自 persist 路径；导入/合并归属应在各 store。
- `drafts.svelte.ts` 对 `DraftPanel.svelte` 导出 16 个符号（宽接口）；`DraftPanel` 内联导入确认绕过 modal。
- 两个「预览行」入口：`session.selectedPreviewRows()`（session:85）vs `drafts.previewRowsNow()`（drafts:53），`Timetable.svelte:2,5` 同时 import 两者；`:125 void search;` 为未用 import 续命。
- 组件越过 stores 直连 storage：`FilterBar.svelte:3,9,20`（filtersOpen）、`TopBar.svelte:29-31`（lastUpdateCheck）。
- `main.ts:58-67 bootAndLaunch` 与 `App.svelte:17-21 openWorkbench` 重复 loadDrafts→launch 序列；`main.ts:35-45`/`45-55` chrome/browser onMessage 双胞胎。
- 死代码：`TopBar.svelte:10` import `banner` 未用；`CourseCard:292-304 chainNode` 单处使用。（`utils.ts rawKeyOf`/`normSeqOf`/`normSeqK` 已在 B1 删除）
- 纯函数不纯：`domain/draft.ts:122 newDraft` 用 `Date.now()` 造 id（同 ms 撞 id）；`domain/scores.ts:71 slimScores` 内嵌 `Date.now()`；`domain/time.ts:43 slotCache` 返回共享引用（可外部变异污染）。
- `api/records.ts:484` `fetchQueueData` 裸 `fetch`（绕过 net/http 的超时/解编码/壳页自愈）并内嵌 `qFailStreak>=3` 熔断。
- `paged.ts` 接口泄漏：调用方须知道 0/1 都映射未分页 URL、页 0-indexed、且需自备 `expectPages`。
- ~~**`domain/timetable-layout.ts:85,106,122` 块键 `code_seq_tag` 不含 day**~~ ✅ 已修（`a130dac`）：
  键改 `code_seq_day_tag`（merge/`laneOf` 按日隔离），钟点 span 的 tag 由恒 0 改为 `when`；
  另有 4 例测试（同大节跨两日 / 拆周段仍并 / 外校课复合日 / 同日两段钟点）。
- **剩余裸课序比较（B1 尾项）**：`domain/flags.ts:64`（`canAdjustZy` 自我排除——同一课班两种拼写会占掉
  自己的志愿档，语义最重）、`stores/drafts.svelte.ts:313,:449`、`Timetable.svelte:72,:108`
  （`findIndex` 失配 → 移除按钮静默无效）。`CreditSimModal`/`DraftCourseRow` 已在 `5b200c3` 收编。
- **`domain/pool.ts:11 hasParsedTime` 兼任 `backfillSelTimes`（session.svelte.ts:609）的「需回填」判定**：
  选课文字说明里含任意 `HH:MM-HH:MM`（如实验/练习时段）即判为「时间已解析」→ 该行不再走服务端回填，
  可能长期挂在这个说明钟点上。v1.5.0 起即如此（本批次只是收拢改名），要分离须新增「大节已解析」谓词。
- `stores/volunteer.svelte.ts:123 volNeedsDeptRetry` ~~的 `isQueuePhase` 形参在唯一调用点恒 false
  （session.svelte.ts:548 已在 `!session.isQueuePhase` 内）→ 该早退分支不可达~~ ✅ 已删参（`a130dac`）。
- `storage/knote.ts knoteLoad` 的旧键迁移只改内存映射，要等下次 `knote` 写入才落盘（幂等，无正确性影响）。

---

## D. 顺序建议与理由

1. ~~**B6**~~ ✅ 已完成（本批次）
2. ~~**B1**~~ ✅ 已完成（本批次）
3. ~~**B2**~~ ✅ 已完成（本批次）；**B3** 待做（依赖 B2 已立的池操作）
4. **B5**（缓存 owner，为 B3 铺路）
5. **B4**（技术风险最高，需先立守门测试；风暴护栏数值锁死）
6. ~~**B7 / B8**~~（B8 ✅ 已完成；B7 ModalHost 拆解待做）
7. ~~**B9** /~~ B10（B9 ✅ 已完成；B10 可并行，任意批次的必备搭子）

已完成批次：B1 `721bf4c` · B2 `8e7a96e` · B5 `18f2a6e` · B6 `b096496` · B7(部分) `12aa979` · B8 `8b91558` · B9 `02e35f8` · B10(部分) `0e9824e`
评审跟进（PR #32 首轮 review）：Step 1 `5b200c3`（学分模拟/草稿行课班查找归一 + 互斥覆盖确认阶段）· Step 2 `d02c04f`（志愿院系拉取判定取反 → 恢复 v1.5.0「过期则拉」，附 `tests/volunteers.test.ts` 7 例守门）
评审跟进（二轮 review）：`a130dac`（课表块键补 day 维度 + 钟点 span 用几何做 tag + `volNeedsDeptRetry` 删死参，附 4 例测试）
剩余未做：**B3**（session 拆解，最大）· **B4**（分页重试统一，风险最高）· B7 尾项（DraftPanel 导入确认）· B10 尾项（见上）· C 节小项（含 B1 尾项裸课序比较等）

## E. 需记录的决策（建议补 ADR，仓库当前无 docs/adr/）

- 周次冲突：单双周互斥、`unknown` 保守判重叠、自定义占用保持全周、外校课入冲突与课表、预览叠加不按周切换（本批次据用户口头决策实现，仅落在 CONTEXT.md「时间冲突」词条）。
- 兼容底线：Firefox 128+、单 IIFE content script、chrome/Firefox storage 双形态（不得引入 ES module content script）。
- reviews 铁律：全程 fail-soft，正文只实时拉取，保留 THU选课社区署名 + CC BY-NC 4.0。
- **窗口新鲜度函数命名约定**（`d02c04f` 教训）：判定函数一律写「过期 → true」，直接把 `volNeedsRefresh`
  传进去（`VolOpts.needsRefresh`）；禁止再套 `ts => !volNeedsRefresh(ts)` 这类双重否定——
  v3 改写期正是这样把 v1.5.0 的「过期则拉」整式取反，且被缺行自愈的 `force=true` 路径掩盖了两代版本。

## F. 依赖方向（评审红线）

`components → stores → api/domain → net/core`；domain/net 禁 import svelte、禁 DOM；store 读完表单 DOM 即写 state，组件不得读 DOM 当状态源。
