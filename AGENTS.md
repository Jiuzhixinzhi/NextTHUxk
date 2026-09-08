# AGENTS.md

NextTHUxk 是清华选课增强浏览器扩展（Manifest V3）。**技术栈：Svelte 5 + TypeScript + Tailwind CSS 4**，由 Vite 构建（`pnpm build` 产出 `dist/` 供 chrome://extensions 或 Firefox about:debugging 加载）。领域语言见 `CONTEXT.md`；功能概览见 `README.md`；发布说明草稿见 `RELEASES.md`。

## 构建与开发

```bash
pnpm install
pnpm build        # 双构建：content.js（单 IIFE，含全部 JS+CSS 内联注入 Shadow DOM）+ popup.html + manifest/icons
pnpm build --watch  # 构建监听（dev 工作流：重新加载扩展验证）
pnpm dev          # 同 build --watch
pnpm test         # vitest（纯域逻辑）
pnpm check        # svelte-check（0 error；a11y 警告可忽略）
```

- **无构建产物提交**：`dist/`、`node_modules/` 已 gitignore；发布由 `.github/workflows/release.yml`（打 tag v*）构建并打包 zip/xpi。
- manifest.json、`src/lib/core/constants.ts` 中的 CUR_VER/BUILD/DATA_VER 三处手动同步；CI 对 tag/manifest/CUR_VER 做一致性守门。

## 架构与分层

```
src/
├─ content/
│  ├─ main.ts              # 入口：顶层窗口+教务域名守卫 → host div + open shadow root → <style>?inline → mount(App)
│  ├─ app.css              # @import "tailwindcss" + @theme 令牌 + --nx-glass/--nx-lg-* 液态玻璃配方 + 全局组件类
│  ├─ App.svelte           # 工作台外壳：launch 按钮、dashboard、banner/toast/modal 出口、#lg-refract SVG 滤镜（单实例）
│  └─ components/          # ui/（Toast·Banner·…）· TopBar · SearchBar(联想) · FilterBar · CourseList/Card ·
│                          # Timetable · QueuePanel · DraftPanel · DraftCourseRow · PlanCards/PlanView · modals/ModalHost 等
├─ popup/                  # index.html + main.ts + App.svelte（独立 ESM 构建，复用玻璃令牌）
└─ lib/
   ├─ core/                # constants（CUR_VER/BUILD/DATA_VER/DEPT 无关常量）/ utils（debounce·runPool·normSeq·lc·fmtTime）
   ├─ net/                 # gbk.ts(+gbk-table 生成数据) · decode（decodeBest/pickDecoded）· http（fetchPage/Dual/Post）
   │                       # · paged（pagedFetch：重试·缺页补抓·EMPTY 吸收·熔断）
   ├─ site/                # webvpn.ts（BASE 编码前缀 + ensureSiteIdentity AES-CBC，key 勿改）
   ├─ storage/             # store.ts（Chrome callback/Firefox Promise 双形态 + 键表 + 遗留键清理）· knote.ts
   ├─ domain/              # 纯函数：types · flags · time（parseTimeSlots/clockRangesOf/SLOT_RANGE）· conflict ·
   │                       # preview（join 池行）· timetable-layout（分道几何）· probability（级联/卷积）·
   │                       # draft（构建/差量 diff）· plancov（培养方案覆盖）
   ├─ api/                 # 服务端 IO：dept（院系码）· search（serverSearch/风暴护栏/tabSearch 兜底）· records
   │                       # （已选/候补/一级课表/分类属性/课余量/详情）· volunteers（BR/Ty 定向拉取）·
   │                       # write（token 链/REJECT_RE/pollUntil/选退课/志愿调整）
   ├─ reviews/             # THU选课社区 SWR 索引 + 三级匹配 + 点评实时拉取（fail-soft，CC BY-NC 署名）
   ├─ update/              # GitHub Releases 检查 + 检查点窗口（volNeedsRefresh/volWindowStart/nextVolCheckpoint）
   └─ stores/              # *.svelte.ts（runes 状态 + 编排）：
                           # session（池/已选/候补/课余量/培养方案/手动占用/启动编排/行合并/时间回填）
                           # search（查询/筛选/分页/跳转定位）· drafts（草稿集/活跃草稿/冲突阻断/提交差量）
                           # volunteer（volMap+检查点窗口缓存+按需补拉自愈）· backup · modal · toast · bus
└─ tests/                  # vitest：时间/冲突/概率/GBK/差量/方案覆盖
```

**依赖方向（强约束，评审时检查）**：components → stores → api/domain → net/core；domain/net 禁止 import svelte、禁止 DOM；store 拦截表单 DOM 读完即写 state，**组件不读 DOM 当状态源**。

## 硬性规则

1. **版本字段**：发版时同步 `manifest.json` version、`CUR_VER`、`BUILD`（src/lib/core/constants.ts）；存储结构变更递增 `DATA_VER`（不匹配即整体清缓存）；严重缺陷版本加入 `DANGEROUS_VERS`。
2. **GBK 双向契约**：中文查询参数必须经 `gbkPercentEncode`（net/gbk.ts）编码（p_kcm / p_zjjsxm / pathContent，UTF-8 直发 0 行）；响应解码用 `decodeBest` / `fetchPageDual`+`pickDecoded`，不得假定单编码。**gbk-table.ts 勿手改**（改 gbk.js 数据后由 node 运行时导出重生；表条目与 b64 半表长度必须一致——历史 Bug：正则截取多了 5 个字符导致整表错位）。
3. **风暴护栏**（api/search.ts `serverSearchStorm`）：精确课号只探 1 页；≤25 页全量，>25 只探 5 页；5 并发 + 30ms×槽位错峰；定向志愿补拉 `p_kch` 限 4 门/次（本批优先、池内旧行分批补）——严禁加深深页探测（历史教训：25 连发打满代理 token）。
4. **一次性 token 链**（api/write.ts `fetchFormSubmit`）：排队二段提交必须从第一段响应 HTML 提取新 token（旧 token 已消耗）；缺新 token 显式报错，不得复用。
5. **不假成功**：选/退/调提交后必须轮询已选/候补列表确认（pollUntil）；拒绝判定走 `REJECT_RE` 字典；唯一例外 `changeVolunteer`（固定 1000ms）。
6. **reviews 铁律**：全程 fail-soft；点评正文只实时拉取不本地囤积；保留「THU选课社区」署名与 CC BY-NC 4.0 声明。
7. **UI 约束**：全部样式进 `content/app.css`（组件内不再写 `<style>`——Svelte `<style>` 会被提取为独立 CSS 文件，脱离 Shadow 内联注入）；液态玻璃统一用 `--nx-glass*`/`--nx-lg-*` 变量 + App 内 SVG `#lg-refract` 滤镜；HTML 转义由 Svelte 模板承担（无手动 innerHTML 拼接）。
8. **兼容底线**：Firefox **128+**（manifest gecko strict_min_version；Tailwind 4 的 CSS 基线）；无 ES module content script（单 IIFE）；chrome.storage 等 API 须同时兼容 Chrome callback 与 Firefox Promise 形态（参考 `NX.store`/`store.ts`）。
9. **WebVPN**：BASE 须保留编码站点前缀（site/webvpn.ts）；`ensureSiteIdentity` 解密 key 勿改。
10. **Svelte 5 runes 注意**：`.svelte.ts` 模块内**禁止导出 `$derived`**（编译器报 derived_invalid_export）——导出为纯函数，组件内以 `$derived.by(() => fn())` 包裹获得响应式；`$effect` 只写在 .svelte 组件内。
11. **旧数据迁移**：v3 起 `stageCart`/`config`/`grade` 键废弃（DATA_VER=7 首启清理，用户定稿：直接丢弃）；草稿 baseFlag 缺位自动按池行回填。

## 验证方式

自动化：`pnpm check`（svelte-check 0 error）→ `pnpm test`（vitest 全绿）→ `pnpm build` 成功。

手动验证：
1. `chrome://extensions`（或 Firefox `about:debugging`）**先移除旧版**再加载 `dist/`，避免新旧实例并存冲突
2. 进入教务域名（需已登录 session）：zhjwxk.cic.tsinghua.edu.cn / zhjw / webvpn
3. Console 核对 `[NextTHUxk] v… 构建 …` 日志；扩展在页面右下角出启动按钮
4. 改动存储/网络后留意 Console 的 `storage.set … FAILED` 与 `Failed to fetch` 告警

## 代码风格

- 文件头 `═══` 框线注释（模块名+角色），分节用 `// ─── 节名 ───`；中文注释；保留溯源注释惯例（用户N报 / #issue / OneTHU 同款 / 历史版本）。
- 类型严格（strict + noUncheckedIndexedAccess）；域逻辑放 domain/（纯函数、可测试）；命名空间意识：module 内私有函数不加 `_`，跨模块私有字段以 `_` 前缀。
- 课程对象核心字段：`code / seq / name / teacher / time / note / flag / zy / credits / capacity / remaining`；课班复合键 `keyOf(code, seq)`（seq 前导零归一）。

## 提交规范

- 沿用现有风格：`xk-<版本> <中文描述>`，一行概括（根因/实锤式注记可附）
- README.md 随版本追加历史节；RELEASES.md 是发布说明草稿（发布前人工定稿）
