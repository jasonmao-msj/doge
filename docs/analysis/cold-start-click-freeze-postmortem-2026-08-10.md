---
type: analysis
status: historical
---

# 冷启点击卡死：6 天全链路追踪与根因修复

> **周期**：2026-08-05 ~ 2026-08-10  
> **机器**：本地 Windows（CXN, 系统 DPI 125%）+ macOS 冒烟  
> **最终状态**：Windows + macOS 均完全解决（platform-split 终局）  
> **基线**：v0.7.15 无此现象；v0.8.x 回归  
> **关联文档**：
> - [`windows-ccgui-startup-hang-2026-08-05.md`](./windows-ccgui-startup-hang-2026-08-05.md) — uiScale / WebView2 初步二分
> - [`windows-cold-start-click-freeze-and-uiscale-0.8-2026-08-07.md`](./windows-cold-start-click-freeze-and-uiscale-0.8-2026-08-07.md) — 列表 × 缩放交叉修复完整记录
> - [`workspace-switch-session-catalog-performance-regression-2026-08-08.md`](./workspace-switch-session-catalog-performance-regression-2026-08-08.md) — 工作区切换性能回归

---

## 0. 问题总览

这不是一个单一的 bug，而是 **两条独立因果链** 在冷启动窗口内交叉叠加，再加一个 **平台引擎行为差异** 导致 Windows WebView2 持续假死。

### 0.1 最终根因

| # | 根因 | 平台 | 表现 |
|---|------|------|------|
| **A** | 冷启 full-catalog 多引擎会话枚举（OpenCode 10s+、Codex、Claude seed、gemini/kimi/grok 刷）在主线程同步 setState，占满 IPC 窗口 | 全平台 | 主线程 57s 内无法处理点击 |
| **B** | `uiScale ≠ 1` 时 native `setZoom(≠1)` → WebView2 `SetZoomFactor` 渲染进程 CPU/内存暴涨 | Windows 专属 | 渲染进程 2GB+ 内存 |
| **C** | 冷启首帧 `useEffect` 中 `apply(1)` 无条件对 `<html>` + `<body>` 写入 20+ CSS inline 属性 → Blink 触发全文档 style recalc + layout → 阻塞 compositor hit-test | Windows 专属 (WebView2) | 点击瞬间假死 |
| **D** | `apply(1)` 零写入导致 WKWebView 懒加载 CSSOM 未初始化 → 首次点击触发同步 style recalc + layout → 主线程死锁 | macOS 专属 (WKWebView) | e0ddd9e99 后 macOS 2s 内点击卡死 |

macOS WKWebView compositor 使用 stale hit-test，不等待主线程布局树，故不受 C 影响。但 WKWebView **懒加载 CSSOM**——当冷启无任何 CSS inline 写入时，computed style tree 不会构建，首次用户点击触发 hit-test → 同步 layout → 死锁。这是与 C 方向相反的因果链：Windows 需要零写入避免 layout 风暴，macOS 需要 CSS 写入触发 CSSOM 预热。

### 0.2 关键人物与角色

| 标识 | git name | email | 角色 |
|------|----------|-------|------|
| **zkp** | `zhukunpenglinyutong` / `朱昆鹏` | `270750933@qq.com` | 0.8.x 列表 hydrate 修复（引入线 A 放大）；全平台 CSS scale + startup guard |
| **cxn** | `chenxiangning` | `chenxiangning1989@126.com` | Windows uiScale 初修、交叉修复、最终根因定位与修复 |

---

## 1. 时间线

### Day 1 — 2026-08-05：初现与 uiScale 二分

**现象**：打开 app 后窗口假死，长时间无 UI。

**诊断**：逐项隔离实验（settings / workspaces / sqlite / client store），二分到 `settings.json` 中 `uiScale: 0.8` 是**充分必要条件**。`uiScale ≠ 1` 任意值均复现，仅 `= 1` 安全。

**根因**：`useUiScaleShortcuts.ts` init 起（`380551d5b`, 2026-02-05）无条件调用 `getCurrentWebview().setZoom(uiScale)`，在 Windows 上落到 wry WebView2 `ICoreWebView2Controller::SetZoomFactor(≠1)` → 渲染进程高 CPU + 内存暴涨。

**修复**（`fix-windows-ui-scale-webview2-hang`）：
- `b62e241fe` — Windows 停用 `setZoom(≠1)`，用 CSS 路径
- `ac0f1a136` — body `transform:scale` + `100/scale%` 填黑边

**留下问题**：transform 路径在叠加 loading + 点击时仍可卡。

**文档**：`windows-ccgui-startup-hang-2026-08-05.md`

---

### Day 2 — 2026-08-06：全平台缩放统一

**发现**：macOS 用户反馈 `uiScale=0.9` 同样卡死。修复升级为三端统一。

**修复**（`fix-ui-scale-native-zoom-freeze-all-platforms`）：
- `7b8710060` — 三端统一 CSS scale + `uiScaleStartupGuard`（上次不健康 → 本次临时 100%，不改写设置）

**留下问题**：0.8 不等 loading 立刻点仍脆。

---

### Day 3 — 2026-08-07：交叉修复——列表轻量化 + 缩放延迟

**发现**：不是单一的 uiScale 问题。冷启 session 列表 hydrate（full-catalog）也单独占满主线程。两条线叠加：

```text
线 A: full-catalog / 重扫 ──────────────┐
                                          ├─→ 主线程/合成忙 → 窗口假死
线 B: 立刻 apply 0.8（transform 扩盒）──┘
```

**关键洞察**：0.7.15 有一个「workspace 未齐就不扫列表」的竞态——偶尔永久跳过列表。0.8.x（`9e3c1bdd8`）修了正确性，副作用是**几乎每次冷启必跑 full-catalog**，放大 IPC 成本。

**修复**：
- 列表 first-paint / full-catalog 分阶段；冷启 +500ms 再 ensure；切 workspace cancel
- 缩放改为 CSS `zoom` + 冷启先 100%，约 2s 后再应用用户缩放
- 启动遮罩 `StartupGateOverlay` 阻挡冷启窗内点击

**状态**：100% 全场景 OK；0.8 等 loading 后点 OK；0.8 立刻点 → macOS 稳定，Windows 仍可卡。

**文档**：`windows-cold-start-click-freeze-and-uiscale-0.8-2026-08-07.md`

---

### Day 4 — 2026-08-08：编排深化与复发根治

**发现**：dump 诊断显示 elapsed 57.5s，没有 first-paint 任务，full-catalog 冒充 gate-ready。

**修复**（`optimize-cold-start-hydration-orchestration` S0–S8）：
- 冷启完成态 = first-paint（非 full-catalog）
- gate-ready 语义收紧，full-catalog timeout 不得冒充 ready
- full-catalog timeout 后 60s cooldown 禁重扫
- Codex 页面扫描真正 bounded（不再 `usize::MAX` → `.take(limit)`）
- 诊断系统 memory-first + 30s batch persist，消除 observer feedback loop
- StartupGate 展开日志改为 click-frozen snapshot，取消 live subscription

**效果**：可交互从 ~57s 降到 ~4.4s。macOS **完全修复**。

**留下问题**：Windows 在 2 秒窗口内点击仍必现卡死。

**文档**：`workspace-switch-session-catalog-performance-regression-2026-08-08.md`

---

### Day 5 — 2026-08-09：第一次修复尝试（未解决问题）

**分析**：macOS 和 Windows UI 层代码路径完全相同，差异仅在 WebView 引擎。诊断数据（401KB 文件，冷启前 10s 仅 2 条事件）显示冷启窗内无诊断风暴，说明 memory-first 策略生效。

**假设**：CSS `zoom` 的 `apply(1)` 在 effect 中无条件写 20+ CSS 属性 → WebView2 Blink 触发布局 → compositor hit-test 阻塞。

**修复**：条件清除 + blankScreenWatchdog 延迟 + color-mix 替换 + 诊断 trim

**结果**：Windows 仍然卡死。**假设被推翻。**

---

### Day 6 — 2026-08-10：最终根因定位与修复

**重新分析**：回顾整个提交历史。macOS 修复的关键是**完全去掉 native `setZoom` 调用**。这使 WKWebView 稳定。Windows 即使不用 native zoom，CSS 写入仍然在 effect 首帧触发 Blink 布局无效化。

**关键洞察**：冷启首帧 `apply(1)` 的 CSS 属性清除操作，在「属性本为空」时仍然写入空字符串 `""`。Blink 无法区分「同值写入」和「清除」——每次 inline style mutation 都触发全量 cascade re-resolution。在 125% DPI 下，这直接拉长了首帧 paint 时间。

**最终修复**（`c0e91a0d3`）：
1. `applyUiScale` 引入 `hasResidualScaleStyle` 守卫：仅当属性有非空值时写入
2. `setScaleLayoutStyles` 在 scale=1 时直接 return，不写 zoom
3. `--ui-scale` 在 scale=1 时跳过写入（CSS `:root` 已有默认值）

**效果**：冷启首帧 → 零 CSS 写入 → 零布局无效化 → compositor 不阻塞。Windows **修复**。

**未检测到的回归**：macOS WKWebView 从旧代码的「无条件 20 属性写入」切换到零写入后，CSSOM 不再在首帧预热。macOS 验证时未在 2s 窗口内点击，漏掉了此回归。

---

### Day 7 — 2026-08-10：macOS 回归发现与 platform-split 终局

**发现**：macOS 真机更新代码后，2s 窗口内点击必现卡死——与 Windows Day 5 症状完全相同，但根因相反。

**关键洞察**：

```text
Windows (Chromium Blink):                 macOS (WKWebView):
  CSS 写入 → style recalc + layout          CSS 写入 → CSSOM 预热（必要！）
            → compositor 阻塞                          → hit-test 缓存就绪
            → 点击假死 ❌                              → 点击正常 ✓
                                            
  零写入   → 布局干净                        零写入   → CSSOM 未初始化
            → compositor 正常                          → 首次点击触发同步 layout
            → 点击正常 ✓                              → 点击死锁 ❌
```

**两边行为完全相反**。同一段代码无法同时满足两个引擎。

**终局修复**（platform-split）：

| 平台 | 路径 | 行为 |
|------|------|------|
| **macOS** | 无条件写入 (旧代码) | 10 属性无条件赋值 `= ""`, 无条件写 `--ui-scale`, scale=1 时写 `zoom = ""` |
| **Windows** | 残留清除 (新代码) | 仅清除非空属性, `--ui-scale` 仅 scale≠1 时写入, scale=1 时零写入 |

改动位置：`src/utils/applyUiScale.ts` — 仅此一个文件。

- `clearScaleLayoutStyles` / `setScaleLayoutStyles_Mac`：macOS 无条件路径
- `clearResidualScaleStyles` / `setResidualScaleLayoutStyles`：Windows 残留清除路径
- `applyCssPageScaleStyles(root, scale, platform)`：按 platform 路由

**效果**：Windows + macOS **均完全修复**。两端都在真机上通过 2s 窗口点击验证。

---

## 2. 全部提交清单（按时间，2026-08-05 ~ 08-10）

| 日期 | Commit | Author | 内容 | 线 |
|------|--------|--------|------|----|
| 08-05 | `2ffbe71e6` | zkp | hydrate Set 新 identity；titles/shared timeout | A |
| 08-05 | `9e3c1bdd8` | zkp | 等 workspacesById 再 auto-hydrate；冷启必 ensure | A |
| 08-05 | `b62e241fe` | cxn | Win 停用 setZoom(≠1)，CSS 路径 | B |
| 08-05 | `ac0f1a136` | cxn | transform 补黑边 | B |
| 08-06 | `7b8710060` | zkp | 三端 CSS scale + startup guard | B |
| 08-07 | `ad325416e` | cxn | 列表 + uiScale 0.8 交叉修复 | A+B |
| 08-07 | `2fe3f354e` | cxn | 启动遮罩挡住冷启点击假死窗 | A+B |
| 08-07 | `9fd602478` | cxn | 桌面冷启动点击假死收口 | A+B |
| 08-08 | `a094a67ab` | cxn | 闭环冷启 first-paint 编排 | A |
| 08-09 | `77f16709a` | cxn | 默认隐藏启动遮罩 | A |
| 08-09 | `db8b3c308` | cxn | 重构加载诊断时间轴 | A |
| 08-09 | `3c3ac3f08` | cxn | **根治冷启点击卡死** | A+B |
| 08-10 | `c0e91a0d3` | cxn | **消除冷启首帧 CSS 写入最终修复** | C |
| 08-10 | `e0ddd9e99` | cxn | 条件 CSS 清除 + blankScreenWatchdog 延迟 + color-mix 替换 | C |
| 08-10 | *(待提交)* | cxn | **platform-split：macOS 无条件 / Windows 残留清除，兼容两端** | C+D |

### OpenSpec Changes

| Change | 内容 | 状态 |
|--------|------|------|
| `fix-windows-ui-scale-webview2-hang` | Win WebView2 setZoom(≠1) 假死初修 | archive |
| `fix-ui-scale-native-zoom-freeze-all-platforms` | 全平台 CSS scale + startup guard | archive |
| `optimize-cold-start-hydration-orchestration` | 冷启 hydration 编排契约重写 | S0–S8 落地 |
| `redesign-startup-diagnostics-timeline` | 诊断时间轴 UI 重设计 | archive |
| `hide-startup-gate-overlay` | Gate overlay manual-only | archive |
| `fix-windows-cold-start-freeze-residual` | **最终修复：platform-split + 条件 CSS 清除** | active |

---

## 3. 根因模型

### 3.1 三层结构

```text
┌──────────────────────────────────────────────────────┐
│ Layer 3: 平台引擎差异                                  │
│ ─────────────────────                                 │
│ WebView2 (Chromium Blink) @ 125% DPI                  │
│   • CSS inline mutation 触发全量 cascade re-resolution │
│   • Compositor hit-test 阻塞等待主线程 layout tree     │
│   • 首帧 paint 在 DPI 缩放下额外耗时                    │
│                                                        │
│ vs                                                     │
│                                                        │
│ WKWebView (WebKit)                                     │
│   • Compositor hit-test 可用 stale layout tree         │
│   • Layout pass 更轻量                                  │
│   • CSS custom property 同值跨 origin 不触发回算         │
└──────────────────────────────────────────────────────┘
          ↑ 放大
┌──────────────────────────────────────────────────────┐
│ Layer 2: 冷启首帧副作用                                │
│ ─────────────────────                                 │
│ useEffect → apply(1)                                  │
│   ├─ 20+ CSS 属性无条件写空字符串 → 布局脏标记           │
│   ├─ --ui-scale:1 重复写 inline → cascade 回算          │
│   ├─ confirmUiScaleHealthy() → localStorage 同步写      │
│   └─ blankScreenWatchdog → getBoundingClientRect 强制布局│
└──────────────────────────────────────────────────────┘
          ↑ 放大
┌──────────────────────────────────────────────────────┐
│ Layer 1: 冷启业务负载                                  │
│ ─────────────────────                                 │
│ full-catalog 多引擎会话枚举                             │
│   ├─ Codex list_threads（~5x 重复）                    │
│   ├─ OpenCode session list（10s+ IPC）                 │
│   ├─ Claude seed / gemini·kimi·grok 刷                 │
│   ├─ project catalog / skills / model_list             │
│   └─ 多轮 setThreads + React reconciliation            │
└──────────────────────────────────────────────────────┘
```

### 3.2 修复后的冷启首帧执行模型（platform-split）

```text
冷启首帧：
  React render → DOM commit
  useEffect:
    apply(1) → applyCssPageScaleStyles(root, 1, platform):

    ┌─ platform === "macos" ─────────────────────────────┐
    │ --ui-scale: 无条件写入 "1"                          │
    │ layout ≠ root → clearScaleLayoutStyles(root)        │
    │   → 10 属性无条件赋值 = ""                           │
    │ setScaleLayoutStyles_Mac(body, 1):                  │
    │   → 9 属性无条件赋值 = ""                            │
    │   → scale=1 → zoom = ""                             │
    │                                                     │
    │ 效果: 20+ CSS 写入 → CSSOM 预热                      │
    │       → WKWebView hit-test 缓存就绪                  │
    │       → 点击正常 ✓                                   │
    └─────────────────────────────────────────────────────┘

    ┌─ platform !== "macos" (Windows/Linux) ─────────────┐
    │ --ui-scale: scale=1 → 跳过（CSS :root 已有默认值）    │
    │ layout ≠ root → clearResidualScaleStyles(root)      │
    │   → ZOOM_FILL_PROPS 逐个检查 → 全部为空 → 零写入     │
    │ setResidualScaleLayoutStyles(body, 1):              │
    │   → clearResidualScaleStyles(body) → 全部为空 → 零写入│
    │   → scale=1 → return（不写 zoom）                    │
    │                                                     │
    │ 效果: 零次 CSS 写入 → 零次布局无效化                   │
    │       → Blink compositor 不阻塞                      │
    │       → 点击正常 ✓                                   │
    └─────────────────────────────────────────────────────┘
```

---

## 4. 关键经验教训

### 4.1 「看起来一样」不代表「行为一样」

macOS 和 Windows 的 UI 代码路径完全相同，但 WebView2 (Chromium Blink) 和 WKWebView (WebKit) 在 CSS 写入触发布局回算、compositor hit-test 机制上有根本差异。**跨平台 UI 代码必须在两台真机上分别验证，不能因为代码相同就推断行为相同。**

### 4.2 冷启首帧是「脆弱窗口」

冷启首帧（从 `ReactDOM.render` 到第一个 GPU paint）是应用最脆弱的时刻：
- 主线程正在构建整个组件树
- CSS 解析器正在解析全部样式
- 布局引擎正在首次计算布局
- Compositor 正在首次合成帧

**此窗口内的任何副作用（CSS 写入、同步 I/O、强制布局）都会放大延迟并阻塞用户交互。**

### 4.3 诊断系统必须审计自身成本

`perf.frame-drop` 采样曾经每帧 durable persist → 掉帧 → 写诊断 → 再掉帧 → feedback loop。修复后 memory-first + 30s batch + 256KB budget 使自身成本降到可忽略。

**任何 telemetry 系统在设计和上线时都必须审计 observer cost。**

### 4.4 Pagination API 的 response limit ≠ source work budget

Codex `list_threads` 的 `limit=5` 只限制返回数量，Rust 侧仍扫完整 `sessions/**` JSONL 目录（~235MB）后才 `.take(5)`。`spawn_blocking + timeout` 不等于 work cancellation——timeout 只停止等待，blocking scan 继续占 I/O。

**所有分页 API 必须区分「返回上限」和「扫描工作量预算」。**

### 4.5 同值不写，是 WebView2 性能的铁律

对 Blink 而言，`el.style.prop = ""`（当 prop 已经为空）**不是 no-op**——它仍然触发 cascade re-resolution。在冷启首帧，20 个「看起来无害」的属性清除操作累计导致可测量的布局回算延迟。

**每一条 inline style mutation 都有成本。在关键路径上，必须 verify-before-write。**

### 4.6 逐步止血 vs 根因治理 vs 跨平台终局

这次修复经历了四个阶段：
1. **止血**（08-05~06）：遮罩 + guard → 防止用户点击触发死循环
2. **减负**（08-07~09）：first-paint 轻量化 + 禁用 auto full-catalog + Codex bounded scan
3. **根除**（08-10 上午）：消除 Windows 首帧所有 CSS 写入
4. **终局**（08-10 下午）：platform-split — 发现 macOS 与 Windows 引擎行为完全相反，分块处理

阶段 3 修复了 Windows 但破坏了 macOS（零写入导致 WKWebView CSSOM 未初始化）。阶段 4 以 platform-split 同时兼容两端。

**教训**：当一个修复声称「macOS 不受影响」时，必须在真机上验证回归。代码路径相同不代表引擎行为相同，两个平台可能对同一段代码有完全相反的依赖。

---

## 5. 后续关注点

| # | 关注点 | 优先级 |
|---|--------|--------|
| 1 | 2s 固定延迟改为 first-paint-complete 事件驱动 | 低（当前已稳） |
| 2 | git/skills/model 冷启错峰（S4 defer） | 低 |
| 3 | 慢机 + 狂切 workspace 压测 | 低 |

---

## 6. 相关文件速查

```text
分析文档:
  docs/analysis/windows-ccgui-startup-hang-2026-08-05.md        ← uiScale 二分
  docs/analysis/windows-cold-start-click-freeze-and-uiscale-0.8-2026-08-07.md ← 交叉修复
  docs/analysis/cold-start-click-freeze-postmortem-2026-08-10.md ← 本文件
  docs/analysis/workspace-switch-session-catalog-performance-regression-2026-08-08.md

源码关键路径:
  src/utils/applyUiScale.ts                     ← 条件 CSS 清除
  src/features/layout/hooks/useUiScaleShortcuts.ts  ← Phase 1/2 延迟
  src/features/app/components/StartupGateOverlay.tsx ← 遮罩层
  src/app-shell-parts/useWorkspaceThreadListHydration.ts ← first-paint 编排
  src/features/startup-orchestration/utils/startupOrchestrator.ts
  src/services/rendererDiagnostics.ts            ← 诊断 byte budget
  src/services/perfBaseline/frameDropMonitor.ts  ← memory-first 掉帧
  src-tauri/src/codex/thread_listing.rs          ← Codex bounded scan
  src-tauri/src/local_usage.rs                   ← Bounded preview scanner

OpenSpec:
  openspec/changes/fix-windows-cold-start-freeze-residual/      ← 最终修复
  openspec/changes/optimize-cold-start-hydration-orchestration/ ← 编排重写
  openspec/changes/fix-ui-scale-native-zoom-freeze-all-platforms/
  openspec/changes/fix-windows-ui-scale-webview2-hang/
```

---

**一句话总结：**

冷启点击卡死是**四条因果链**的叠加——(1) full-catalog 多引擎会话枚举占满主线程，(2) uiScale≠1 的 native zoom 拖死 WebView2 渲染进程，(3) 冷启首帧 20+ 次无意义 CSS 属性写入触发 Blink 全文档布局回算阻塞 compositor hit-test，(4) 零 CSS 写入导致 WKWebView CSSOM 懒加载未初始化——首次点击触发同步 layout 死锁。(3) 和 (4) 方向相反，同一段代码无法同时兼容两个引擎。macOS 修好编排即解决 (1)，但 (4) 在消除 (3) 后才暴露出来。Windows 需要零写入避免 layout 风暴，macOS 需要无条件写入触发 CSSOM 预热——platform-split 是唯一终局。6 天，3 个 OpenSpec changes，~2000 行改动，四条因果链，一个 platform-split 干净收尾。
