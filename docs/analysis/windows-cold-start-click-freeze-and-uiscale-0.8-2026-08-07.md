---
type: analysis
status: historical
---

# Windows 冷启动点击假死 + uiScale 0.8 修复分析

> **日期**：2026-08-07（撰写），2026-08-10（补充 §10 并最终修复）  
> **机器**：本地 Windows（用户 **CXN**，系统 DPI 125%）  
> **最终状态**：✅ **已完全解决**（2026-08-10 commit `c0e91a0d3`）。详尽时间线见 [`cold-start-click-freeze-postmortem-2026-08-10.md`](./cold-start-click-freeze-postmortem-2026-08-10.md)  
> **对比基线**：v0.7.15 **无此现象**；v0.8.x 回归  
> **相关**：`docs/analysis/windows-ccgui-startup-hang-2026-08-05.md`（uiScale / WebView2 根因，本报告是其续篇与交叉修复）  
> **提交记录**：见 **§0A 人物与提交台账**、**§0B 两日修复全清单**（作者均来自 `git log`，禁止凭记忆改写）

---

## 0A. 人物与提交台账（Author / Committer）

> 邮箱与 name 以 git 对象为准。同一人可能出现 `zhukunpenglinyutong` 与 `朱昆鹏` 两种 Author name（邮箱同为 `270750933@qq.com`）。

| 标识 | git name | email | 本问题中的角色 |
|------|----------|-------|----------------|
| **zkp** | `zhukunpenglinyutong` / `朱昆鹏` | `270750933@qq.com` | 侧栏 hydrate 必加载修复（`2ffbe71e6` / `9e3c1bdd8`）；全平台 CSS scale + startup guard（`7b8710060`）；0.8.0/0.8.2 版本合并 |
| **cxn** | `chenxiangning` | `chenxiangning1989@126.com` | Windows WebView2 uiScale 假死初修（`b62e241fe`）；transform 补黑边（`ac0f1a136`）；本机 **2026-08-07** 交叉修复会话（列表分阶段 + CSS zoom + 冷启动缩放延迟，**截至文档撰写时仍为 working tree，未 `git commit`**） |
| **现场用户** | CXN | — | 复现、验收、收敛 repro（100% / 0.8 等 loading / 0.8 立刻点） |

### 0A.1 相关 commit 明细（按时间）

| 时间 (UTC+8) | short | Author | email | subject | 与本 hang 关系 |
|--------------|-------|--------|-------|---------|----------------|
| 2026-08-05 12:20 | `2ffbe71e6` | zhukunpenglinyutong | 270750933@qq.com | fix(threads): publish memo-safe hydration Set so sidebar drops loading | **列表线**：Set identity + titles/shared timeout + soft-ignore；侧栏可卸「加载中」 |
| 2026-08-05 13:44 | `b377e88c7` | zhukunpenglinyutong | 270750933@qq.com | release: bump to v0.8.0 and harden hydration and update-check paths | 版本线：0.8.0 发布携带 hydrate 加固 |
| 2026-08-05 16:27 | `9e3c1bdd8` | zhukunpenglinyutong | 270750933@qq.com | fix(sidebar): fix cold-start thread hydration and shrink first-paint loads | **列表线关键**：修 workspacesById 竞态导致 **永不 ensure**；冷启动 **几乎必跑 list**（相对 0.7.15 放大成本） |
| 2026-08-05 18:54 | `b62e241fe` | chenxiangning | chenxiangning1989@126.com | fix(ui-scale): 修复 Windows WebView2 uiScale 假死并恢复右侧 chrome 默认可见 | **缩放线**：Windows 避开 `setZoom(≠1)`，初修假死 |
| 2026-08-05 21:27 | `ac0f1a136` | chenxiangning | chenxiangning1989@126.com | fix(ui-scale): 用 transform 布局补偿修复 Windows 缩放黑边 | **缩放线**：改 transform+fill 消黑边；后被证在「loading+0.8+立刻点」仍脆 |
| 2026-08-05 21:34 | `d654d59d8` | chenxiangning | chenxiangning1989@126.com | Merge pull request #1028 from chenxiangning/win-version-0.8 | 合入 win 0.8 相关（含上列 ui-scale） |
| 2026-08-06 12:43 | `7b8710060` | zhukunpenglinyutong | 270750933@qq.com | fix(ui-scale): stop native zoom freezes on all platforms with CSS scale and startup guard | **缩放线**：三端统一 CSS scale + `uiScaleStartupGuard`；native 钉 1 |
| 2026-08-06 22:28 | `4ae5f09cc` | 朱昆鹏 | 270750933@qq.com | Merge pull request #1038 … bump-version-0.8.2 | 0.8.2 版本合并（含 guard 等） |
| 2026-08-07（会话） | *working tree* | **CXN 本机会话**（未 commit） | — | 见 §0B 批次 W3–W5 | **交叉修复**：列表 first-paint + full 后置；orchestrator cancel/并发；CSS zoom；冷启动先 100% 再延后 0.8 |

> 更早引入「统一 `setZoom(uiScale)`」见 `docs/analysis/windows-ccgui-startup-hang-2026-08-05.md` §0.2（`zkpaiminmin` / init，不在「最近两日」范围内，但为缩放线总源）。

---

## 0B. 最近两日（约 2026-08-05～08-07）针对本问题的修复全清单

按 **时间顺序 + 批次**。区分：**已入库 git** vs **本机未 commit**。

### 批次 W1 — 2026-08-05 列表 / hydrate（Author: zhukunpenglinyutong）

| # | commit | 修复内容 | 解决什么 | 留下什么 |
|---|--------|----------|----------|----------|
| W1.1 | `2ffbe71e6` | `hydratedThreadListWorkspaceIds` 发布 **新 Set identity**；titles/shared `withTimeout`；soft-ignore | 侧栏 memo 不更新导致永久「加载中」 | soft-ignore 后台仍跑；多一次 state |
| W1.2 | `9e3c1bdd8` | `workspacesById` 齐了再 auto-hydrate；缓存 list 先显示；首屏页改小（~5） | 冷启动 **跳过 list** 永久卡加载 | **几乎每次冷启动必 ensure**，放大 IPC/主线程窗 |

### 批次 W2 — 2026-08-05～06 缩放（Author: chenxiangning → zhukunpenglinyutong）

| # | commit | Author | 修复内容 | 解决什么 | 留下什么 |
|---|--------|--------|----------|----------|----------|
| W2.1 | `b62e241fe` | chenxiangning | Win 用 CSS 路径，native 非 1 停用 | `setZoom(≠1)` 假死 | 黑边 |
| W2.2 | `ac0f1a136` | chenxiangning | body **transform:scale + 100/scale%** 填黑边 | 铺满视口 | 扩合成层；+loading+点击仍可卡 |
| W2.3 | `7b8710060` | zhukunpenglinyutong | 三端 CSS scale；**startup guard**（上次不健康 → 本次临时 100%，不改 settings） | 全平台 native≠1；锁死循环可自救 | 仍可能用 transform 路径；冷启动+0.8+立刻点未彻底 |

### 批次 W3 — 2026-08-07 列表线交叉修复（CXN 本机会话，**未 commit**）

| # | 改动位置 | 修复内容 |
|---|----------|----------|
| W3.1 | `startupOrchestrator.ts` | active-workspace **并发 1**；`thread-session-scan` **并发 1**；`cancelWorkspaceTasks` **立刻 settle + 释放槽位** |
| W3.2 | `useWorkspaceThreadListHydration.ts` | **first-paint / full-catalog** 分阶段；冷启动 **+500ms** 再 ensure；切 workspace cancel；hydrate UI **startTransition**；first-paint 只标 UI hydrated，full 才 fully |
| W3.3 | `useThreadActions.ts` + `useThreadActions.threadList.ts` | first-paint **跳过** project catalog / claude seed / gemini·kimi·grok 刷；await 间 **yield**；setThreads **startTransition**；`isStale` |
| W3.4 | 测试 | `useWorkspaceThreadListHydration.test.tsx` 等对齐新行为 |

**效果（用户）**：100% 快速点击 OK；整体「loading 中一点就死」**改善很大**。

### 批次 W4 — 2026-08-07 缩放线交叉修复（CXN 本机会话，**未 commit**）

| # | 改动位置 | 修复内容 |
|---|----------|----------|
| W4.1 | `applyUiScale.ts` | **弃用** transform+fill；仅 **CSS `zoom`**；native 仍只 `setZoom(1)` 一次 |
| W4.2 | `useUiScaleShortcuts.ts` | 启动 **先 apply(1)**；用户 scale≠1 时 **约 2s 后再 apply**；settings **不改写**；startup guard 保留 |
| W4.3 | `base.css` | 注释禁止恢复 transform 扩盒 |
| W4.4 | 测试 | `applyUiScale.test.ts` / `useUiScaleShortcuts.test.tsx` |

**效果（用户）**：0.8 等 loading 再点 OK；0.8 **不等 loading 立刻点也稳定**（点时仍是 100%，约 2s 后切 0.8）。

### 批次 W5 — 文档与打包（CXN 本机会话）

| # | 产物 | 说明 |
|---|------|------|
| W5.1 | 本文件 | 分析 + 提交台账 + 两日清单 |
| W5.2 | 前序 | `docs/analysis/windows-ccgui-startup-hang-2026-08-05.md`（08-05，uiScale 二分） |
| W5.3 | 本地 NSIS | `release-local/ccgui_0.8.3_x64-setup.exe` 等（含 W3+W4 时需 **mtime 在对应修复之后** 的包） |

### 0B.1 时间线总览

```text
08-05 12:20  zkp   W1.1  hydrate Set / soft-ignore
08-05 16:27  zkp   W1.2  冷启动必 ensure（修永不加载）
08-05 18:54  cxn   W2.1  Win 停 setZoom(≠1)
08-05 21:27  cxn   W2.2  transform 补黑边
08-06 12:43  zkp   W2.3  全平台 CSS scale + startup guard
08-07 会话   CXN   W3    列表 first-paint + orchestrator（未 commit）
08-07 会话   CXN   W4    CSS zoom + 冷启动延后 0.8（未 commit）
08-07 会话   CXN   W5    本文档
```

---

## 0. 结论先行

| 项 | 内容 |
|----|------|
| **不是单一 bug** | 两条线叠加：**冷启动 session 列表 hydrate 占满主线程/IPC**，以及 **`uiScale≠1` 的缩放实现在 WebView2 上脆弱** |
| **为何 0.7.15 没事** | 0.7.15 有冷启动 `activeWorkspaceId` 早于 `workspacesById` 时 **永久跳过 list** 的竞态（侧栏可能卡「加载中」但未必跑重扫）；0.8.x（`9e3c1bdd8` 等）修好了「列表永远不来」，副作用是 **几乎每次冷启动必跑 full-catalog** |
| **为何 100% 先好、0.8 仍脆** | 列表路径修轻后，100% 下点击已稳；0.8 仍走 `transform:scale + 扩盒`（或叠加载），**loading 中再点**会把合成/主线程打穿 |
| **最终稳定策略** | ① 列表 **first-paint 轻量 + full-catalog 后置**；② 缩放改为 **CSS `zoom`**；③ **冷启动先钉 100%，约 2s 后再应用用户 0.8** |
| **macOS** | 列表/编排改动三端共用（利大于弊）；缩放 CSS `zoom` + 2s 延迟 **会改变 Mac 观感**，需冒烟；详见 §5 |

---

## 1. 现象演进（现场口径）

### 1.1 最初描述

- 打开 app 卡死  
- 曾怀疑仅 `uiScale≠1` / 旧 dist / 打包未进新代码  

### 1.2 收敛后的稳定 repro（用户）

| # | 步骤 | 结果 |
|---|------|------|
| A | uiScale **100%**，冷启动，快速连点左键 | **OK**（修后） |
| B | uiScale **0.8**，打开后 **等 loading 结束** 再点 | **OK**（修后） |
| C | uiScale **0.8**，打开后 **不等 loading 立刻点** | 曾 **必卡**；现用「先 100% 再延后 0.8」规避 |
| D | v0.7.15 同类操作 | **无此现象** |

### 1.3 诊断误区（已纠正）

| 误判 | 事实 |
|------|------|
| 「打包一直用仓库陈旧 dist」 | 正式 `beforeBuildCommand: npm run build` 会重建；本地 `dist/` 陈旧 ≠ 安装包陈旧 |
| 「多 CLI 才卡」 | 0.7.15 已多 CLI + startupOrchestrator；差的是 **0.8.x 冷启动 list 接线** |
| 「只改 uiScale 就够」 | 列表 full-catalog 单独即可占满；**两条线都要修** |
| 「日志说 bootstrap 过了就不是渲染」 | `setZoom`/首帧 effect 之后可冻；pending 诊断 flush 会骗人 |

---

## 2. 根因分层

### 2.1 线 A — 冷启动 session 列表 hydrate（与缩放无关）

```text
冷启动 → default workspace 激活
  → ensureWorkspaceThreadListLoaded
  → listThreadsForWorkspace（多引擎：titles / shared / codex 分页 /
     list_workspace_sessions 全引擎 catalog / claude seed / gemini·kimi·grok 刷…）
  → 多次 dispatch + AppShell/Sidebar 重渲
  → 主线程/IPC 窗口内任意点击表现为假死
列表落地 / 重活结束 → 可点
```

**0.7.15 → 0.8.x 关键提交（作者均为 `zhukunpenglinyutong <270750933@qq.com>`）：**

| Commit | 时间 | 作用 | 与回归关系 |
|--------|------|------|------------|
| `2ffbe71e6` | 2026-08-05 12:20 | hydrate Set 新 identity；titles/shared timeout；soft-ignore | 多 state / 超时后后台仍跑 |
| `9e3c1bdd8` | 2026-08-05 16:27 | 等 `workspacesById` 再 ensure；缓存先显示；首屏页改小 | **必跑 list**（修了「永不加载」） |

### 2.2 线 B — uiScale≠1（WebView2）

| 阶段 | 机制 | 证据 |
|------|------|------|
| 历史 | `setZoom(uiScale≠1)` → SetZoomFactor | 2026-08-05 矩阵：仅 `uiScale=1` 安全 |
| 0.8.x「修假死」 | body `transform:scale` + `width/height:100/scale%` | 消黑边，但扩合成层；**+ 冷启动 + 点击** 仍可卡 |
| 本机 0.8 特征 | 等 loading 完再点 OK；loading 中点卡 | 缩放实现与加载窗 **交叉** |

### 2.3 交叉模型

```text
                    ┌─ 线 A: full-catalog / 重扫 ────────────────┐
冷启动 ─────────────┤                                              ├─→ 主线程/合成忙
                    └─ 线 B: 立刻 apply 0.8（transform 扩盒）──────┘
                              + 用户 pointer
                                    │
                                    ▼
                              窗口假死
```

100% 时只有线 A，修轻列表后可点。  
0.8 时线 B 在 loading 窗内叠加 → 仍卡。

---

## 3. 代码改了什么

### 3.1 文件清单（相对修复前主线）

| 文件 | 改动摘要 |
|------|----------|
| `src/utils/applyUiScale.ts` | **弃用** transform+fill；**CSS `zoom`**；native 仍只钉 1 一次 |
| `src/features/layout/hooks/useUiScaleShortcuts.ts` | 启动 **先 apply(1)**；用户 scale≠1 时 **约 2s 后再 apply**；startup guard 保留 |
| `src/styles/base.css` | 注释：禁止恢复 transform 扩盒 |
| `src/app-shell-parts/useWorkspaceThreadListHydration.ts` | **first-paint / full-catalog** 分阶段；冷启动 **延迟 500ms** 再 ensure；切 workspace **cancel**；hydrate UI `startTransition` |
| `src/features/threads/hooks/useThreadActions.ts` | first-paint **跳过** project catalog + claude seed + gemini/kimi/grok 刷；await 间 **yield**；setThreads 走 **startTransition**；`isStale` |
| `src/features/startup-orchestration/utils/startupOrchestrator.ts` | active-workspace **并发 1**；`thread-session-scan` **并发 1**；cancel **立刻释放槽位** 并 settle |
| 配套测试 | applyUiScale / useUiScaleShortcuts / useWorkspaceThreadListHydration |

### 3.2 线 A 关键设计

```text
冷启动 +500ms
  → first-paint list（轻：codex 小页 + last-good，无多引擎 catalog）
  → 侧栏卸「加载中…」（UI hydrated）
  → idle/0ms 后再 full-catalog（重：catalog + 其它引擎）
切 workspace → cancelWorkspaceTasks(旧 id) → isStale 丢弃晚到 setThreads
```

### 3.3 线 B 关键设计

```text
mount / uiScale 变化
  → 立刻 CSS zoom=1 + setZoom(1) 钉死 native
  → 若用户 scale≠1 且非 guard 强制 1：
        setTimeout(2000) → CSS zoom=用户值 + markUiScalePending
  → settings.json 不改写
```

**验收对应：** loading 中立刻点 = 仍是 100%；约 2s 后切到 0.8。

### 3.4 刻意不做的

- 不静默把用户 `uiScale` 写回 1  
- 不修 wry/WebView2 上游  
- 不把 Linux 误当成「和 Windows 同一引擎」单独结论（本机未复测 Linux）

---

## 4. 验收与打包

### 4.1 现场（用户）

- 100%：快速点击 OK  
- 0.8：等 loading 再点 OK  
- 0.8：不等 loading 立刻点 — 修后 **稳定**（见用户反馈）

### 4.2 本地包

- NSIS：`src-tauri/target/release/bundle/nsis/ccgui_0.8.3_x64-setup.exe`  
- 副本：`release-local/ccgui_0.8.3_x64-setup.exe`  
- 签名：缺 `TAURI_SIGNING_PRIVATE_KEY` 时 updater 签名失败，**安装包本体仍可用**  
- WebView2：本机构建曾用 `downloadBootstrapper` 规避 offline bootstrapper 下载超时（见 `tauri.windows.local-nsis.conf.json`）

---

## 5. macOS 影响审查（查漏补缺）

### 5.1 会动到 Mac 的改动

| 改动 | 三端共用？ | Mac 影响 |
|------|------------|----------|
| first-paint / full-catalog 分阶段 | 是 | **正**：冷启动更轻、更可点；列表可能先短后全 |
| 列表延迟 500ms ensure | 是 | 侧栏多半秒「加载中」可接受 |
| orchestrator 并发收紧 + cancel | 是 | **正**：少叠扫 |
| setThreads startTransition + yield | 是 | **正**：点击优先 |
| CSS `zoom` 承载 uiScale | 是 | **行为变化**：原先 Mac 文档倾向 native `setPageZoom`；现与 Win 统一 CSS zoom |
| 非 100% 缩放启动后 **延迟 ~2s** 再应用 | 是 | **观感**：启动先 100% 再缩到 0.8/1.2，Mac 同样会「跳一下」 |
| setZoom(1) 钉一次 | 是 | 清旧构建残留 pageZoom；一般安全 |

### 5.2 Mac 风险分级

| 风险 | 级别 | 说明 | 建议 |
|------|------|------|------|
| 启动 2s 缩放「跳变」 | 中 | 产品可见 | Mac 可冒烟；若难受可把 delay 与 first-paint ready 对齐或仅 Windows 延迟 |
| CSS `zoom` vs 原 native pageZoom | 中 | WebKit 对 CSS zoom 支持有，布局/fixed/拖拽与 Chromium 略有差 | 0.8 / 1.0 / 1.2 快捷键 + 设置项 + 分栏拖拽手测 |
| 黑边 / 未铺满 | 低～中 | 曾因 zoom 黑边改 transform；现又回 zoom | 依赖 base.css % 链；Mac 看一眼壳是否铺满 |
| first-paint 列表不完整 | 低 | 随后 full-catalog 补全 | 与 Win 相同；可接受 |
| setZoom(1) 异常 | 极低 | catch 吞掉 | 已有 |

### 5.3 Mac 未做 / 应做的验收

- [ ] macOS 冷启动 uiScale=0.8：是否仍可立刻点  
- [ ] 2s 后缩放是否平滑可接受  
- [ ] 快捷键 ± / 重置  
- [ ] 分栏、modal、标题栏拖拽  
- [ ] Retina + 系统缩放各一档  

**结论：** 列表 / 编排 / CSS zoom 改动 **三端共用**。  
**启动遮罩：** 现 `isStartupGatePlatform()` = **任意 Tauri desktop**（Win / macOS / Linux）；组件 `StartupGateOverlay`；强关 10s「直接进入」；max 20s force-enter。

### 5.3b 全量修复收口（2026-08-07 晚）

| 证据 | 内容 |
|------|------|
| 危险条件 | **任意 `uiScale ≠ 1`**（0.8 / 0.9 / 1.1 / 1.2 / … 全部同类） |
| 复现 | 冷启动，**loading 结束前点界面按钮** → 必现假死 |
| 交叉模型 | 线 A full-catalog + 线 B 早期 CSS zoom(**任意 ≠1**) 叠点击 |
| 安全对照 | **仅 `uiScale === 1`** 不走 phase-2 zoom；线 A 靠遮罩挡点击 |
| 止血 | 桌面遮罩；强关 10s +「直接进入」；`cancelAllTasks("stale")` + force-enter |
| 根因加固 | phase-2 等 **gate-ready** / force-enter+2s / **12s 天花板** |
| force-enter | 取消 idle full-catalog 重扫；hydrate fallback 认 stale\|cancelled；不 stamp gate-ready |
| 命名 | `StartupGateOverlay` / `startupGate` i18n（旧 Windows* re-export） |

### 5.4 若要减少 Mac 回归面（可选后续）

```text
方案 M1（推荐若 Mac 抱怨跳变）：
  detectRendererPlatform()==="windows" 才延迟 2s 应用 ≠1；
  macOS/Linux 仍立即 CSS zoom（或 Linux 跟 Mac）。

方案 M2：
  延迟结束条件改为「first-paint list 完成 / active-workspace-ready」
  而非固定 2000ms（三端更一致、可测）。
```

当前实现为 **固定 2s、三端一致**，实现简单、现场已稳；M1/M2 属 polish。

---

## 6. 仍存在的缺口与跟进

| # | 缺口 | 优先级 |
|---|------|--------|
| 1 | 固定 2s 与列表真实结束未绑定；慢机可能仍叠一点 | 中 → 建议 M2 |
| 2 | full-catalog 后台仍重；列表已出后狂切 workspace 是否再卡未压测 | 中 |
| 3 | CSS zoom 黑边 / 坐标：Win 125% DPI + 0.8 需目视 | 中 |
| 4 | macOS / Linux 真机矩阵未在本报告机完成 | 高（发版前） |
| 5 | soft-ignore 下 native IPC 仍可能跑完；依赖 isStale 丢弃 setState | 已缓解，非零成本 |
| 6 | `npm run build:win-x64` 仍被 branding doctor 拦；打包脚本对 exit 1 误报成功 | 工程债 |
| 7 | 安装包 updater 签名依赖 `TAURI_SIGNING_PRIVATE_KEY` | 发布流程 |
| 8 | 文档 `windows-ccgui-startup-hang-2026-08-05` 中「transform 策略」已过期，应以本报告 + 代码为准 | 文档债 |

---

## 7. 回归与责任边界（简）

完整提交人与两日清单见 **§0A / §0B**。摘要：

| 角色 | 提交人 | 说明 |
|------|--------|------|
| 引入「非 1 native zoom」 | 早期 init（见 08-05 报告，`zkpaiminmin`） | 总源 |
| 0.8.x 列表必 hydrate | **zhukunpenglinyutong** `2ffbe71e6` / `9e3c1bdd8` | 修侧栏正确性，放大冷启动成本 |
| Win 停 setZoom + transform 黑边 | **chenxiangning** `b62e241fe` / `ac0f1a136` | 缩放线第一波 |
| 全平台 guard + CSS scale | **zhukunpenglinyutong** `7b8710060` | 缩放线第二波 |
| 列表分阶段 + zoom + 冷启动延后 0.8 | **CXN 本机会话（2026-08-07，未 commit）** | 交叉修复，现场已稳 |

**不是**「用户配置非法」：`uiScale: 0.8` 是产品合法值。

---

## 8. 给后续开发的硬约束

1. **禁止** Windows 上对 WebView 调 `setZoom(≠1)`。  
2. **禁止** 恢复 body `transform:scale` + `100/scale%` 扩盒当默认策略。  
3. 冷启动 **禁止** 在首屏同一帧同步跑 full multi-engine `list_workspace_sessions` 当唯一路径。  
4. 切 workspace 必须能 **cancel / isStale** 旧 list apply。  
5. 改缩放或冷启动 list 必须过：**Win 100%+125% DPI × 0.8/1.0 × 立刻点/等 loading**；Mac 冒烟。  

---

## 9. 相关路径

```text
分析（本文件）: docs/analysis/windows-cold-start-click-freeze-and-uiscale-0.8-2026-08-07.md
前序 uiScale:     docs/analysis/windows-ccgui-startup-hang-2026-08-05.md
缩放 apply:       src/utils/applyUiScale.ts
缩放 hook:        src/features/layout/hooks/useUiScaleShortcuts.ts
startup guard:    src/utils/uiScaleStartupGuard.ts
列表 hydrate:     src/app-shell-parts/useWorkspaceThreadListHydration.ts
list 实现:        src/features/threads/hooks/useThreadActions.ts
编排:             src/features/startup-orchestration/utils/startupOrchestrator.ts
shell 高度链:     src/styles/base.css
```

---

**一句话：**  
0.8.x 修好了「列表永远不来」，却让冷启动必跑重扫；叠上 0.8 的 transform 缩放，loading 中一点就死。现改为 **轻列表先出 + 重扫后置**，缩放 **CSS zoom** 且 **冷启动先 100% 再延后应用用户缩放**；Mac 共享编排收益，但缩放延迟与 CSS zoom 需冒烟，必要时改为仅 Windows 延迟。

---

## 10. 2026-08-09 续报：macOS 已解决，Windows 2s 窗口仍复现

> **状态**：macOS 测试完全通过。Windows 在 2 秒内点击（含 force-enter 后立即点击、展开加载日志等）仍会卡死，超过 2 秒后正常。总体改善明显但未根治。

### 10.1 代码审计结论

macOS 与 Windows 的 UI 层代码路径**完全相同**：
- `usesCssPageZoom()` 所有平台返回 `true`，统一 CSS zoom
- `applyUiScale` 一律只写 CSS，不调 native setZoom
- `StartupGateOverlay` 行为一致
- 冷启 hydration 编排一致

**平台差异仅在引擎层：** Windows = WebView2 (Chromium Blink) + 125% DPI；macOS = WKWebView (WebKit)。

### 10.2 诊断数据分析

`diagnostics.json`（`%USERPROFILE%\.ccgui\client\`）：
- 文件大小 401KB，超出 256KB byte budget **57%**
- 跨 4 天（Aug 5-9）多 session 累积合并
- 冷启前 10 秒仅 2 条事件（无意义的 `window/error`）→ memory-first + 30s batch persist 正在生效
- 帧掉/longtask 均在 ~108 秒后才出现（消息流式渲染，非冷启窗内）
- 冷启窗内**没有诊断风暴**——系统本身已被抑制

关键推论：**卡死时连 rAF 回调都无法执行**（否则会有 `perf.frame-drop` 条目），说明主线程被完全阻塞而非轻微 jank。

### 10.3 根因推论（WebView2 特定连锁反应）

```text
t=0ms    React 首帧渲染 → DOM 构建
t≈0ms    useEffect 触发 apply(1)
           ├─ 无条件清除 html/body 上 20+ CSS inline 属性
           │  (zoom, transform, width, height, position...)
           ├─ width/height 置空 → Blink 标记整个文档 layout tree 脏
           └─ 125% DPI 下 Blink 的样式重算 + 布局成本显著高于 WebKit

t≈0ms    同帧：confirmUiScaleHealthy() → localStorage.removeItem() → 同步磁盘 I/O

t=500ms  COLD_START_FIRST_PAINT_DELAY → first-paint list 启动
           └─ Codex list_threads IPC → list_threads response → setThreads (React setState)

t=1s     StartupGateOverlay summary refresh → setInterval → setState → React re-render

t=1.5s   blankScreenWatchdog 首次检查
           ├─ getElementById("root")
           ├─ getBoundingClientRect()  ← 强制同步布局！
           ├─ getComputedStyle()       ← 强制同步布局！
           └─ 此时 React 正在 reconciliation → forced layout 阻塞主线程

此时用户点击（展开加载日志 / 其他 overlay 按钮）
  → WebView2 compositor 需要 hit-test（确认点击目标）
  → hit-test 依赖 layout tree 的最新状态
  → 但主线程正在 style recalc + layout + React render
  → compositor 阻塞等待主线程
  → 用户感知：窗口假死
```

**为何 macOS 不卡：** WKWebView 的 compositor hit-test 可以使用 stale 布局树而不等待主线程；且 WebKit 的 layout pass 在标准缩放下更快。

**为何 2 秒后不卡：** 2s 时 first-paint list 通常已完成（~4.4s），React reconciliation 已沉降；即使 force-enter（10s）后立即点击，first-paint 的 setState 已结束，主线程空闲。

**为何代码中 2 秒与 `UI_SCALE_AFTER_FORCE_ENTER_DELAY_MS` 对齐：** uiScale phase-2（去应用用户 ≠1 缩放）要等到 gate-ready（first-paint complete ~4.4s）或 force-enter+2s 后才执行。在这之前 CSS zoom=1，不触发缩放相关的 compositor 开销。所以点击卡死的 2s 窗口**不是缩放本身**导致的，而是 CSS 属性写操作 + 强制布局 + React setState 的叠加效应。

### 10.4 修复方案

#### P0-1：消除冷启时的无效 CSS 属性写操作

**文件**：`src/utils/applyUiScale.ts`

`apply(1)` 无条件清除 html/body 上 20+ CSS inline 属性。在冷启首帧这些属性本无值，清除操作仍使 Blink 标记布局脏。改为仅清除**实际有残留值**的属性。

```ts
// Before: 无条件 20-property flush
el.style.zoom = "";  el.style.width = "";  el.style.height = "";  // ...

// After: 仅写实际有值的属性
for (const prop of ZOOM_FILL_PROPS) {
  if (el.style[prop] !== "") el.style[prop] = "";
}
```

冷启首帧时所有属性为空 → 零次写入 → 零布局无效化。

#### P0-2：冷启 gate 期间跳过 blankScreenWatchdog

**文件**：`src/services/rendererDiagnostics.ts`、`src/bootstrapApp.tsx`

`blankScreenWatchdog` 每 1.5s 调用 `getBoundingClientRect()` + `getComputedStyle()` 触发强制同步布局。冷启时 overlay 全覆盖，白屏检测无意义。改为冷启窗内跳过检查。

```ts
// bootstrapApp.tsx：传入 startDelayMs 覆盖整个 gate 窗口
startRendererBlankScreenWatchdog({
  rootId: "root",
  startDelayMs: 15_000,
});
```

#### P1-1：替换 StartupGateOverlay 的 color-mix 为分层 opacity

**文件**：`src/features/app/components/StartupGateOverlay.tsx`

`color-mix(in_srgb, var(--surface-messages) 92%, transparent)` 在 WebView2 上需要 GPU shader 计算。改为 `background + opacity` 分层渲染避免 shader 开销。

#### P1-2：诊断文件读取时主动 trim

**文件**：`src/services/rendererDiagnostics.ts`

当前 401KB 文件（超预算 57%）在每次冷启时读取/解析。首次加载时主动 trim 到 256KB 预算并写回。

### 10.5 仍存在的缺口

| # | 缺口 | 优先级 |
|---|------|--------|
| 9 | 以上 4 个修复合并后需在 Windows 125% DPI 实机验证 | **高** |
| 10 | macOS 回归冒烟：分层 opacity 替代 color-mix 的视觉效果 | **中** |
| 11 | 如 P0 改动仍不根治，需上 WebView2 DevTools 录制 Performance trace | **中** |
| 12 | `applyUiScale` 的冷启优化可能需要添加 focused 单元测试 | **低** |
