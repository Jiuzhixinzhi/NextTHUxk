# AGENTS.md

NextTHUxk 是清华选课增强浏览器扩展（Manifest V3，纯 vanilla JS/CSS）。**无构建、无包管理器、无测试框架**——改完文件即生效。领域语言见 `CONTEXT.md`；功能与版本历史见 `README.md`；发布说明草稿见 `RELEASES.md`。

## 架构与加载顺序

脚本由 `manifest.json` 的 content_scripts 按下列顺序注入，**依赖链严格成立**；新增脚本必须登记进 manifest 且保持相对顺序：

```
config（定义 NX/常量/存储/网络）→ gbk（GBK 编码表）→ data（抓取/解析/选退课 API）
→ probability（中签概率）→ reviews（THU选课社区）→ state（课表/暂存/草稿/冲突）
→ render（渲染与筛选）→ ai → update → content.js（唯一入口 IIFE：Shadow DOM + 启动编排）
```

- 模块间只经 `NX.*` 命名空间通信；**后加载文件可覆盖早期同名函数**（例：content.js 覆盖 update.js 的 `volNeedsRefresh`）——改动或改名跨文件函数前，先查 manifest 顺序与全部定义
- 分层职责：config=基础设施 · data=IO · state=领域状态 · render=UI · content=启动编排；IO 与渲染不得混层
- content.js 入口守卫：仅顶层窗口 + 三个教务域名（zhjwxk / zhjw / webvpn）注入；popup 消息由此转发

## 硬性规则

1. **版本字段**：发版时同步 `manifest.json` version、`NX.CUR_VER`、`NX.BUILD`（src/config.js:13-14）；存储结构变更递增 `NX.DATA_VER`（不匹配即整体清缓存）；严重缺陷版本加入 `NX.DANGEROUS_VERS`
2. **GBK 双向契约**：中文查询参数必须经 `NX.gbkPercentEncode`（gbk.js）编码（p_kcm / p_zjjsxm / pathContent，UTF-8 直发 0 行）；响应解码用 `decodeBest` / `fetchPageDual`+`pickDecoded`，不得假定单编码
3. **风暴护栏**（data.js `serverSearchStorm`）：精确课号只探 1 页；≤25 页全量，>25 只探 5 页；5 并发 + 30ms×槽位错峰；定向志愿补拉 `p_kch` 限 4 门/次（本批优先、池内旧行分批补）——严禁加深深页探测（历史教训：25 连发打满代理 token）
4. **一次性 token 链**：排队二段提交必须从第一段响应 HTML 提取新 token（旧 token 已消耗）；缺新 token 显式报错，不得复用
5. **不假成功**：选/退/调提交后必须轮询已选/候补列表确认（pollUntil）；拒绝判定走 `REJECT_RE` 字典；唯一例外 `changeVolunteer`（固定 1000ms）
6. **reviews.js 铁律**：全程 fail-soft；点评正文只实时拉取不本地囤积；保留「THU选课社区」署名与 CC BY-NC 4.0 声明
7. **UI 约束**：全部样式在 `content.css`（Shadow DOM 内联注入）；液态玻璃统一用 `--nx-glass`/`--nx-lg-*` 变量 + content.js 内 SVG `#lg-refract` 滤镜；HTML 拼接必须过 `NX.esc()`
8. **兼容底线**：Firefox 115+（manifest gecko strict_min_version）；无 ES module；chrome.storage 等 API 须同时兼容 Chrome callback 与 Firefox Promise 形态（参考 `NX.store`）
9. **WebVPN**：BASE 须保留编码站点前缀（content.js 入口处理）；`ensureSiteIdentity` 解密 key 勿改

## 验证方式

无自动化测试/静态检查，改完手动验证：

1. `chrome://extensions`（或 Firefox `about:debugging`）**先移除旧版**再加载本目录，避免新旧实例并存冲突
2. 进入教务域名（需已登录 session）：zhjwxk.cic.tsinghua.edu.cn / zhjw / webvpn
3. Console 核对 `[NextTHUxk] v… 构建 …` 日志（排查旧构建疑案）；扩展在页面右下角出启动按钮
4. 改动存储/网络后留意 Console 的 `storage.set … FAILED` 与 `Failed to fetch` 告警

## 代码风格

- 文件头 `═══` 框线注释（模块名+角色），分节用 `// ─── 节名 ───`（对齐列宽）
- 中文注释；保留溯源注释惯例（用户N报 / #issue / OneTHU 同款 / v1.3.x 历史）
- 公开 API 挂 `NX.xxx`；`_` 前缀 = 私有（state 字段、内部计时器）；IIFE 内私有函数不加 `_`
- 课程对象核心字段：`code / seq / name / teacher / time / note / flag / zy / credits / capacity / remaining`；课班复合键 `code + '_' + normSeq(seq)`（seq 前导零必须归一）
- 渲染：课程列表用渐进渲染（RENDER_CHUNK=80 + IntersectionObserver）与容器级事件委托；其余视图可逐元素绑定

## 提交规范

- 沿用现有风格：`xk-<版本> <中文描述>`，一行概括（根因/实锤式注记可附）
- README.md 随版本追加历史节；RELEASES.md 是发布说明草稿（发布前人工定稿），发版时更新其中示例
