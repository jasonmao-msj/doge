---
type: analysis
status: historical
---

# Windows 本机 `cc-gui.exe` 启动卡死调研

> **日期**：2026-08-05（撰写），2026-08-10（最终解决）  
> **最终状态**：✅ **已完全解决**。全链路记录见 [`cold-start-click-freeze-postmortem-2026-08-10.md`](./cold-start-click-freeze-postmortem-2026-08-10.md)  
> **机器**：本地 Windows（用户 CXN）  
> **现象**：打开 `ccgui` / `cc-gui.exe` 后窗口假死，长时间无 UI  
> **平台**：Windows（WebView2）已证实；macOS（WKWebView）未见；Linux（WebKitGTK）无 hang 证据  
> **实现入口**：`src/utils/applyUiScale.ts` + `useUiScaleShortcuts.ts`；规格见 `openspec/changes/fix-windows-ui-scale-webview2-hang/`
>
> **⏩ 2026-08-06 后续（平台结论已过期，以此为准）**：现场反馈 **macOS `uiScale=0.9` 同样卡死**，上文 §0.3「Mac 未见同症」系样本不足。修复策略已升级为 **三端统一 CSS scale、全平台 native zoom 钉 1**，并新增启动看门狗。见 OpenSpec change `fix-ui-scale-native-zoom-freeze-all-platforms`。
>
> **⏩ 2026-08-10 最终修复**：追加根因——冷启首帧 useEffect 中 `apply(1)` 无条件写入 20+ CSS 属性 → Blink 全文档布局回算阻塞 compositor hit-test。改为条件清除（`hasResidualScaleStyle` 守卫），冷启首帧零 CSS 写入。见 [`cold-start-click-freeze-postmortem-2026-08-10.md`](./cold-start-click-freeze-postmortem-2026-08-10.md)。

---

## 0. 根因（结论先行）

| 项 | 内容 |
|----|------|
| **根因配置** | `%APPDATA%\com.zhukunpenglinyutong.ccgui\settings.json` 中 `"uiScale": 0.8` |
| **根因规则** | 任意 **`uiScale ≠ 1`** 均可单独复现；**仅 `uiScale === 1` 安全** |
| **根因代码** | `src/features/layout/hooks/useUiScaleShortcuts.ts` 的 `useEffect` 调用 `getCurrentWebview().setZoom(uiScale)` |
| **原生落点（Windows）** | Tauri plugin `set_webview_zoom` → wry `webview2::zoom` → **WebView2 `ICoreWebView2Controller::SetZoomFactor`** |
| **原生落点（macOS）** | wry `wkwebview::zoom` → **`WKWebView::setPageZoom`**（实现路径不同，见 §0.3） |
| **现场表现** | host 进程空闲；**msedgewebview2 渲染进程**高 CPU + 内存暴涨（可达 2GB+）；UI 假死 |
| **诊断表象** | 磁盘上常只剩 `bootstrap/start`（见 §0.2，属观测偏置，不是真正卡在 preload） |
| **最小复现** | `{"uiScale":0.8}` → FAIL；`{"uiScale":1}` → PASS；完整 settings 仅把 `uiScale` 改回 `1` → PASS |
| **本机临时修复** | `settings.json` 的 `uiScale` 已改为 `1`（其余字段保留）；备份 `settings.json.poison` |

### 0.1 问题产生机制（因果链）

```text
用户曾在设置里把「界面缩放」调到 80%（或其它非 100%）
        │
        ▼
settings.json 持久化  "uiScale": 0.8
        │
        ▼
下次冷启动 → AppShell 挂载 → useAppSettings 读到 uiScale=0.8
        │
        ▼
useUiScaleShortcuts 的 useEffect 依赖 [uiScale]
        │
        ▼
getCurrentWebview().setZoom(0.8)
        │
        ▼  (Windows / WebView2)
plugin:webview|set_webview_zoom
        │
        ▼
wry webview2 controller.SetZoomFactor(0.8)
        │
        ▼
WebView2 渲染进程进入异常重绘/内存膨胀
（本机实测：host ~50MB 空闲；renderer 数分钟内 300MB→2GB+，CPU 持续累计）
        │
        ▼
页面主线程/渲染管线被拖死 → 窗口假死
```

**和启动诊断的关系（为何看起来像 bootstrap 卡住）：**

1. `bootstrap()` 里 `preloadClientStores` 完成后会 **立即 flush** early 诊断 → 磁盘上出现 `bootstrap/start`  
2. 之后的 `preload-complete` / `i18n-ready` / `render-committed` 走 **2s 节流 pending buffer**  
3. `ReactDOM.render` **同步只调度** commit；`useEffect`（含 `setZoom`）在 commit 之后跑  
4. `setZoom(≠1)` 若在首帧 effect 内就把 WebView 冻住 → pending 诊断 **再也 flush 不出去**  
5. 观测结果：磁盘只有 `bootstrap/start`，容易误判为「卡在 storage preload」

真正致命点在 **React 首屏 effect 里对 WebView2 调 `SetZoomFactor(非 1)`**，不是 settings 文件本身损坏，也不是 client store / sqlite。

### 0.2 是哪次代码变更引入的？谁提交的？

| 角色 | 提交 | 作者 | 日期 | 做了什么 | 与本 hang 的关系 |
|------|------|------|------|----------|------------------|
| **引入根因逻辑** | `380551d5b`（更早同内容：`8b14419cb`） | **zkpaiminmin** `<270750933@qq.com>` | **2026-02-05** | 仓库 `init`：新增 `useUiScaleShortcuts.ts`，在 `useEffect` 里无条件调用 `getCurrentWebview().setZoom(uiScale)` | **就是这条路径**。从第一天起，只要用户把 `uiScale` 存成非 1，Windows 上就会走 WebView2 `SetZoomFactor` |
| 相关增强（非引入 zoom） | `dcb43e560` | chenxiangning `<chenxiangning1989@126.com>` | 2026-04-28 | `feat(shortcuts): 扩展可配置应用快捷键`：把 UI 缩放快捷键做成可配置 + i18n，**保留既有 `setZoom` 调用** | 放大了「用户会去改缩放」的产品面，但 **没有新写 setZoom** |
| 相关防护（非本 hang 修复） | `84c6481e0` | e_jiaxiaofenga `<e_jiaxiaofenga@enn.cn>` | 2026-07-31 | `fix: 修复浏览器预览启动崩溃…`：给 `getCurrentWebview()` 包 `try/catch`，避免 **非 Tauri 浏览器预览** 同步抛错被 React 19 ErrorBoundary 整页吃掉 | 只防 **同步 throw**；**防不住** WebView2 `SetZoomFactor` 之后渲染进程疯跑/假死 |

**结论（责任归因）：**

- **引入「用 Tauri native zoom 驱动界面缩放」的代码**：`zkpaiminmin` 在 **2026-02-05 `init`** 提交写入。  
- **把用户状态推到危险值的操作**：本机用户（或某次 UI 操作）把设置里的界面缩放调到 **80%**，写入 `settings.json` 的 `uiScale: 0.8`。  
- **不是** 2026-08 的 v0.8 hydration 改动、**不是** APPDATA 其它文件、**不是** 安装目录陈旧 `dist/`。

代码原貌（init 起即存在，逻辑至今等价）：

```ts
// src/features/layout/hooks/useUiScaleShortcuts.ts
useEffect(() => {
  if (typeof window === "undefined") return;
  // 2026-07-31 起外包 try/catch（仅防非 Tauri 同步 throw）
  void getCurrentWebview()
    .setZoom(uiScale)   // uiScale 来自 settings，默认 1；用户可改为 0.8…2.6
    .catch(() => undefined);
}, [uiScale]);
```

合法取值范围（产品允许 80%）：`src/utils/uiScale.ts` 中 `UI_SCALE_MIN = 0.8`，`0.8` 还是 preset 列表第一项——**配置合法，Windows 运行时不稳**。

### 0.3 为什么 Windows 会挂、macOS 没有？Linux 呢？

同一前端 `setZoom`，wry **三端后端完全不同**（本机 wry 0.53.5）：

| 平台 | wry 文件 | Native API | 引擎 | 与本 hang 的关系 |
|------|----------|------------|------|------------------|
| **Windows** | `webview2/mod.rs` | `ICoreWebView2Controller::SetZoomFactor` | **Chromium Edge WebView2** | **已证实**：`uiScale≠1` → 渲染进程高 CPU/内存假死（本机 125% DPI） |
| **macOS** | `wkwebview/mod.rs` | `WKWebView::setPageZoom` | **WebKit** | **未见同症**；用户反馈正常；实现与 COM ZoomFactor 无关 |
| **Linux** | `webkitgtk/mod.rs` | `WebView::set_zoom_level` | **WebKitGTK** | **本次未在 Linux 复现**；**不是 WebView2**，不能当成「和 Windows 一样必挂」 |
| Android | no-op | — | — | 不支持 zoom |

前端入口相同，后端三分叉：

```text
JS:  getCurrentWebview().setZoom(uiScale)
  →  invoke('plugin:webview|set_webview_zoom', { value })
  →  wry::WebView::zoom(scale_factor)
        ├─ Windows: SetZoomFactor(scale)     ← 本 hang 根因路径
        ├─ macOS:   setPageZoom(scale)       ← 当前可保留
        └─ Linux:   set_zoom_level(scale)    ← 未证实 hang；策略见 §10–§11
```

**Win 特有机制（有证据）：**

1. 引擎是 WebView2 + COM ZoomFactor，不是 WebKit。  
2. 本机 OS 显示缩放 125%（`--device-scale-factor=1.25`）与 `ZoomFactor≠1` 叠乘，易触发异常重绘/内存膨胀。  
3. 复现矩阵仅在 Windows 跑通：`uiScale≠1` 全 FAIL，`=1` 全 PASS。

**Mac 为何没出现：**

1. 走 `setPageZoom`，与 `SetZoomFactor` 不是同一实现。  
2. Retina / 显示缩放模型不同。  
3. **不是**「Mac 没执行这段 JS」——同样会 `setZoom`，只是 native 不拖死进程。

**Linux 为何不能抄 Windows 结论：**

1. 底层是 **WebKitGTK `set_zoom_level`**，与 WebView2 无关。  
2. 本次 **零台 Linux 实机证据**。  
3. WebKit 系对 CSS `zoom` 的支持/布局语义也不如 Chromium 稳。  
→ 修复策略上 **Linux 默认跟 macOS 走 native**，除非后续 Linux 复现同类 hang（见 §10 审核与 §11 策略表）。

### 0.4 一句话总结

> **init 起用统一 JS `setZoom(uiScale)`；Windows 落到 WebView2 `SetZoomFactor`，在 `uiScale≠1`（本机还叠 125% DPI）时拖死渲染进程。macOS/Linux 分别是 WKWebView / WebKitGTK 另一套 API，不能按 Win 结论一刀切。**

---

## 1. 现象摘要

| 观察 | 结果 |
|------|------|
| 进程是否起来 | 是，`cc-gui.exe` 存活，窗口标题 `ccgui - ccgui` |
| 主机进程 | ~50MB，CPU 几乎不动 |
| WebView2 渲染进程 | 持续高 CPU + 内存暴涨：数分钟内数百 MB → **2GB+** |
| 系统内存 | 总 64GB / 空闲 50GB+，**不是 OOM** |
| WebView2 版本 | Edge WebView `151.0.4129.59`；进程参数含 `--device-scale-factor=1.25` |

---

## 2. 安装位与版本事实

| 项 | 值 |
|----|-----|
| 主程序 | `C:\Users\CXN\AppData\Local\ccgui\cc-gui.exe` |
| 注册表 DisplayVersion | **0.7.16** |
| PE `FileVersionRaw` | **0.7.16.0** |
| PE 字符串 `FileVersion` | **0.3.0**（元数据不一致，非本 hang 主因） |
| 安装目录旁路 `dist/` | 仅有陈旧 `assets/`、**无 `index.html`**；移走 dist **仍 hang** → 旁路 dist **不参与** 本 hang |

生产包前端资源内嵌于 exe；安装目录残留 `dist/` 是脏安装面，但 **不是本次根因**。

---

## 3. 运行时数据目录

| 角色 | 路径 |
|------|------|
| App home（client store / startup_guard） | `%USERPROFILE%\.ccgui\` |
| Tauri app data（**settings / workspaces / sqlite**） | `%APPDATA%\com.zhukunpenglinyutong.ccgui\` |
| WebView2 profile | `%LOCALAPPDATA%\com.zhukunpenglinyutong.ccgui\EBWebView\` |
| 安装本体 | `%LOCALAPPDATA%\ccgui\` |
| 诊断 | `%USERPROFILE%\.ccgui\client\diagnostics.json` |

---

## 4. 逐项隔离实验结果

### 4.1 安装 / 用户数据层（判定：40s 内是否出现 `preload-complete` / `render-committed`）

| Id | 操作 | 结果 | max renderer MB |
|----|------|------|-----------------|
| B0 | 基线（不删） | **FAIL** | ~932 |
| I1 | 移走安装目录 `dist/` | **FAIL** | ~804 |
| D1 | 清空 `~\.ccgui\client` | **FAIL** | ~873 |
| D2 | 清空 `~\.ccgui` 运行时文件 | **FAIL** | ~753 |
| D3 | 清空整个 APPDATA `com.zhukunpenglinyutong.ccgui` | **PASS** | ~282 |
| D5 | 全清用户态 | **PASS** | ~276 |

→ **毒源在 APPDATA 应用数据，不在 client store / 安装 dist。**

### 4.2 APPDATA 内二分

| Id | 操作 | 结果 |
|----|------|------|
| R0 | 基线 | FAIL |
| R1 | 仅移走 `shared-event-log-v2.sqlite3*` | FAIL |
| R2 | **仅移走 `settings.json`** | **PASS** |
| R3 | 仅移走 `workspaces.json` | FAIL |
| R4 | 移走 runtime ledger / window-state | FAIL |
| R5 | 移走 `session-management/` | FAIL |
| R6 | 移走 `shared-context-artifacts/` | FAIL |
| R8 | 只保留 settings+workspaces | FAIL |
| R9 | 移走 settings+workspaces，保留其余 | PASS |

→ **充分必要条件：`settings.json`。**

### 4.3 `settings.json` 字段二分（131 keys）

脚本：`scripts/tmp-settings-bisect.mjs`（临时）

| 步骤 | 结果 |
|------|------|
| empty `{}` | PASS |
| full 131 keys | FAIL |
| binary search | **`MINIMAL_FAIL_KEYS=["uiScale"]`** |
| `KEY uiScale = 0.8` | — |

### 4.4 `uiScale` 数值矩阵（node 写无 BOM JSON）

| settings 内容 | 结果 |
|---------------|------|
| `{"uiScale":0.8}` | **FAIL** |
| `{"uiScale":0.9}` | **FAIL** |
| `{"uiScale":1}` / `1.0` | **PASS** |
| `{"uiScale":1.1}` | **FAIL** |
| `{"uiScale":1.2}` | **FAIL** |
| `{"uiScale":1.5}` | **FAIL** |
| `{"uiScale":2}` | **FAIL** |
| **完整 poison settings 但 `uiScale` 改成 1** | **PASS** |

注意：PowerShell `Set-Content -Encoding utf8` 会写 **BOM**，可能导致 settings 解析失败并回落默认 → 假 PASS。二分必须以 node/`fs.writeFileSync` 无 BOM JSON 为准。

---

## 5. 代码路径与依赖版本

**前端（仓库）**

```ts
// src/features/layout/hooks/useUiScaleShortcuts.ts  （init 起存在）
useEffect(() => {
  void getCurrentWebview()
    .setZoom(uiScale)
    .catch(() => undefined);
}, [uiScale]);
```

**JS API**

```js
// @tauri-apps/api/webview.js
async setZoom(scaleFactor) {
  return invoke('plugin:webview|set_webview_zoom', {
    label: this.label,
    value: scaleFactor,
  });
}
```

**Native（本机 cargo registry wry-0.53.5，与当前 lock 一致）**

```rust
// wry webview2 (Windows)
pub fn zoom(&self, scale_factor: f64) -> Result<()> {
  unsafe { self.controller.SetZoomFactor(scale_factor) }.map_err(Into::into)
}

// wry wkwebview (macOS)
pub fn zoom(&self, scale_factor: f64) -> crate::Result<()> {
  unsafe { self.webview.setPageZoom(scale_factor); }
  Ok(())
}
```

- `uiScale` 产品范围：`0.8 … 2.6`（`src/utils/uiScale.ts`）  
- 详细因果链 / 提交归因 / Win vs Mac：见 **§0.1–§0.3**

---

## 6. 已排除项

| 假设 | 结论 |
|------|------|
| 系统内存不足 | ❌ |
| 仅 GPU（`--disable-gpu`） | ❌ |
| diagnostics / threads client store | ❌（D1/D2 仍 FAIL） |
| sqlite WAL 损坏 | ❌（R1 仍 FAIL） |
| 安装目录 `dist` 陈旧 | ❌（I1 仍 FAIL；且生产资源内嵌） |
| workspaces / session-management / artifacts | ❌ |
| 卡在 `preloadClientStores` IPC 本身 | ❌（观测偏置，见 §0.1） |
| macOS 缺 `setZoom` 代码 | ❌（两端同 JS；差异在 native） |

---

## 7. 本机已做的临时修复

```text
文件: %APPDATA%\com.zhukunpenglinyutong.ccgui\settings.json
变更: "uiScale": 0.8  →  "uiScale": 1
备份: settings.json.poison（同目录）
      以及 C:\Users\CXN\.ccgui-hang-bisect-20260805175538\roaming-full\
验证: full-settings + uiScale=1 → PASS（render-committed）
```

用户可直接再开 `cc-gui.exe` 验证。若在设置里再次把界面缩放调离 100%，**Windows 上可能再次卡死**（直到 §8 代码修复落地）。

---

## 8. 给开发读哪里

| 章节 | 内容 |
|------|------|
| **§10** | **换角度审核**（反方意见、陷阱、三端差异）——先读，避免抄错策略 |
| **§11** | **修复实施规格**（可照做；含 Win/Mac/Linux 适配表） |
| **§0** | 根因与机制（背景） |

**修订后默认策略（摘要）：**

| 平台 | 缩放怎么做 | 原因 |
|------|------------|------|
| **Windows** | CSS `zoom` 表达 `uiScale`；native **只** `setZoom(1)` | WebView2 `SetZoomFactor(≠1)` 已证实假死 |
| **macOS** | native `setZoom(uiScale)`；清掉 CSS zoom | WKWebView 路径当前正常，少改回归面 |
| **Linux** | **默认与 macOS 相同：native `setZoom(uiScale)`** | 底层是 WebKitGTK，**不是** WebView2；无 Linux hang 证据；CSS zoom 在 WebKit 上更不稳 |
| **unknown / 浏览器预览** | 仅 CSS `zoom`（无 Tauri 则无 native） | 保守、可测 |

---

## 9. 相关路径速查

```text
安装:     %LOCALAPPDATA%\ccgui\
用户态:   %USERPROFILE%\.ccgui\
AppData:  %APPDATA%\com.zhukunpenglinyutong.ccgui\settings.json   ← 触发配置（uiScale）
源码:     src/features/layout/hooks/useUiScaleShortcuts.ts         ← setZoom 调用点
native:   Win SetZoomFactor | Mac setPageZoom | Linux set_zoom_level
WebView:  %LOCALAPPDATA%\com.zhukunpenglinyutong.ccgui\EBWebView\
诊断:     %USERPROFILE%\.ccgui\client\diagnostics.json
本报告:   docs/analysis/windows-ccgui-startup-hang-2026-08-05.md
```

---

## 10. 换角度审核（方案评审，开发必读）

> 上一版实施草稿曾写「Linux 跟 Windows 一样只用 CSS」。**这不严谨。** 本节从反方/兼容性角度重审，§11 已按此收敛。

### 10.1 原先方案的问题

| 问题 | 说明 |
|------|------|
| **把 Linux 当成 Windows** | Linux 走 wry `webkitgtk::set_zoom_level`，与 `SetZoomFactor` **无关**。无实机 hang 证据时，强行改 CSS 会多引入 WebKit 布局风险。 |
| **「全平台 CSS zoom」过重** | 能统一代码，但改变 macOS 既有观感/行为，回归面大，且不是修 hang 所必需。 |
| **平台探测选错工具** | `src/utils/platform.ts` 的 `isWindowsPlatform()` **内部要求 `isTauri()`**，非 Tauri 时恒为 `false`。缩放 apply 更适合 `detectRendererPlatform()`（`rendererPlatform.ts`，与 `main.tsx` 的 `data-platform` 一致）。 |
| **诊断误导** | 磁盘只有 `bootstrap/start` 易被当成 preload 故障；真凶是 mount 后 `setZoom`。修 bootstrap 超时 **治不了** 根因。 |
| **timeout 包 setZoom** | hang 是渲染进程失控，不是 Promise 慢；timeout **无效**。 |
| **CSS zoom 副作用** | 分割条拖拽等用 `clientX` + `getBoundingClientRect`（如 `DesktopLayout.tsx`）。Chromium 下二者通常同比例缩放，**多数情况仍一致**，但 fixed / canvas / 自定义坐标要手测。 |
| **CSS zoom + 100vh 壳子** | 仅给 root 设 `zoom` 与 `width/height: 100/scale%` **不够**：若 `#root`/`.app` 仍是 `100vh`/`100vw`，视口单位不跟 parent 放大，**外层壳不随缩放铺满窗口**（缩小留边、放大裁切）。必须把 shell 改成 `html→body→#root→.app` 的 `%` 高度链（`src/styles/base.css`）。 |
| **CSS zoom 落在 `<html>`** | 在 `overflow: hidden` 下 WebView2 容易 **先裁剪再缩放**：`100/scale%` 扩出来的盒子被视口裁掉后，再 zoom 缩小 → 仍黑边。应让 `<html>` 保持 100% 视口，**zoom + fill 落在 `<body>`**（见 `applyUiScale.ts`）。 |

### 10.2 三端能力对照（实现选型依据）

| 维度 | Windows | macOS | Linux |
|------|---------|-------|-------|
| wry zoom API | `SetZoomFactor` | `setPageZoom` | `set_zoom_level` |
| 引擎 | Chromium WebView2 | WebKit (WKWebView) | WebKitGTK |
| 本 hang 证据 | **有（实机矩阵）** | **无** | **无（未测）** |
| CSS `zoom` | Chromium **支持好** | 有支持，但非当前产品路径 | WebKitGTK **支持/语义弱于 Chromium**，不优先 |
| 系统 DPI 叠乘风险 | **高**（本机 125% 已中招） | 中（Retina 另一套） | 中（桌面缩放多样） |
| 推荐缩放载体 | **CSS zoom** | **native setZoom** | **native setZoom**（默认） |
| native 非 1 是否允许 | **禁止** | 允许 | 允许（除非日后证实 hang） |

### 10.3 两种架构怎么选

| 架构 | 做法 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| **分平台（推荐）** | Win=CSS；Mac/Linux=native | 对准根因；Mac 零行为变化；Linux 少瞎改 | 要测两条路径；单测要 mock 平台 | **默认** |
| **全平台 CSS** | 三端都 CSS + native 钉 1 | 代码最简单 | Mac/Linux 行为变化大；WebKit CSS zoom 风险 | 仅当产品要求视觉完全一致时再考虑 |
| **Win 锁 100%** | Win 强制 uiScale=1 | 最快止血 | 功能残缺 | 仅热修/应急 |

### 10.4 兼容性注意点（按平台）

**Windows**

- 必须避免 `setZoom(uiScale)` 且 `uiScale≠1`。  
- 升级用户可能残留 ZoomFactor≠1 → 切换 CSS 后仍要 **`setZoom(1)` 钉死**（防双重缩放 / 残留坑）。  
- 验收系统 DPI：**100% 与 125%** 都要做（证据机是 125%）。  
- 手测：冷启动、缩放快捷键、设置页改缩放、标题栏/分栏拖拽、modal。

**macOS**

- 保持 `setZoom(uiScale)`，**不要**无故改成 CSS。  
- 清除 `documentElement.style.zoom`，避免以后有人在 Win 写了 zoom 又同步到 Mac 造成双重缩放。  
- 冒烟：80% / 100% / 120% 快捷键与设置项。  
- wry 文档：page zoom 需较新系统（macOS 11+）；低于此本就不是本 hang 范围。

**Linux**

- **默认 native** `setZoom(uiScale)` → `set_zoom_level`。  
- **不要**仅因「和 Windows 都是桌面 Linux 也危险」就改 CSS。  
- 若 Linux 后续复现「非 1 缩放假死/爆内存」，再 **单独** 把 Linux 切入 CSS 策略（与 Win 同），并补实机证据到本文。  
- 手测（有环境时）：Wayland / X11 至少一种；uiScale 0.8 与 1.2 冷启动。

**跨平台 settings 兼容**

- `uiScale` 字段三端共用同一 JSON，**不要**做平台分文件。  
- 同一用户云同步/拷贝配置：Win 上 0.8 用 CSS 渲染，Mac 上 0.8 用 native，**视觉可能略有差异**——可接受；语义都是「界面 80%」。  
- **禁止**在 Win 上把用户的 0.8 静默改写成 1 并写回磁盘（除非产品明确要求）；修 hang 应让 0.8 **能启动且仍是 80% 观感**。

### 10.5 平台探测该用哪个

| API | 位置 | 行为 | 缩放 apply 是否推荐 |
|-----|------|------|---------------------|
| `detectRendererPlatform()` | `src/utils/rendererPlatform.ts` | 读 UA / platform，返回 `windows\|macos\|linux\|unknown`；`main.tsx` 已写 `data-platform` | **推荐** |
| `isWindowsPlatform()` / `isMacPlatform()` | `src/utils/platform.ts` | **仅 `isTauri()` 为 true 时**才解析 navigator，否则恒 false | 可用但不完整（无 linux 细分；非 Tauri 失效） |

**规格要求：** `applyUiScale` 入参使用 `RendererPlatform`（四值），由 `detectRendererPlatform()` 提供。

### 10.6 审核结论（给实现的决策）

1. **只对 Windows 切换缩放载体（CSS）**；这是有证据的最小充分修复。  
2. **macOS / Linux 默认保持 native `setZoom(uiScale)`**。  
3. Windows 在套 CSS 的同时 **`setZoom(1)` 清 native**。  
4. 单测至少覆盖 `windows` 与 `macos` 两分支；`linux` 与 `macos` 同断言即可。  
5. 全平台 CSS、或 Linux 跟 Win，需要 **额外产品/实机理由**，不作为本 hang 的默认范围。

---

## 11. 修复实施规格（给开发：可照做）

> **目标读者**：按 §10 决策落地的同事。  
> **约束**：外科手术；不重构 AppShell / settings 全链路。  
> **业务代码尚未改**；以下为待实现规格（2026-08-05 代码）。

### 11.1 目标与非目标

| 要做 | 不要做 |
|------|--------|
| Windows：`uiScale≠1` 冷启动不假死，缩放仍可用 | 改 Tauri/wry 上游 |
| 保留 `uiScale` 字段与 0.8–2.6 产品范围 | 静默把用户 Win 上的 0.8 改成 1 写回盘 |
| macOS / Linux：行为与现网一致（native zoom） | 无证据把 Linux 改成 CSS |
| 单测覆盖 Win vs Mac 分支 | 为假想场景堆平台代码 |

**完成定义：**

1. Windows（**125% DPI 必测**）+ `uiScale:0.8` 冷启动 ≤10s 可交互，有 `bootstrap/render-committed`，renderer 不持续涨到 GB  
2. Windows 快捷键缩放到 0.8/1.2 不假死  
3. macOS 冒烟：缩放快捷键与设置项正常  
4. Linux 有环境则冒烟；无环境则单测覆盖「linux 与 macos 同路径」  
5. 相关 vitest + typecheck 通过  

### 11.2 挂载关系（改哪里）

```text
useAppSettingsController
  └─ useUiScaleShortcuts({ settings: appSettings, setSettings, saveSettings })
        │
        ├─ useEffect([uiScale])  →  今日：无条件 setZoom(uiScale)  ← 必改
        ├─ increase/decrease/reset → 只改 settings.uiScale（可不动）
        └─ keydown 快捷键 → 调用上述（可不动）

复用：
  detectRendererPlatform()  ← src/utils/rendererPlatform.ts   【推荐】
  clampUiScale / UI_SCALE_* ← src/utils/uiScale.ts
  --ui-scale 变量占位       ← themes.dark.css（可选写入）

一般不必改：
  useAppSettingsController / useAppSettings / SettingsView / src-tauri
```

### 11.3 三端策略表（PR 必贴）

| `detectRendererPlatform()` | CSS `documentElement.style.zoom` | CSS `--ui-scale` | native `setZoom` |
|----------------------------|----------------------------------|------------------|------------------|
| **windows** | `String(clampedScale)` | 同左 | **仅 `1`**（清 ZoomFactor） |
| **macos** | `""`（清除） | `String(clampedScale)` | **`clampedScale`** |
| **linux** | `""`（清除） | `String(clampedScale)` | **`clampedScale`**（与 mac 相同） |
| **unknown** | `String(clampedScale)` | 同左 | 有 API 则 **`1`**（无 Tauri 则跳过） |

> `unknown` 含浏览器预览：无 WebView2，CSS 足够；若误探测为 unknown 的桌面，CSS 也比误调 SetZoomFactor 安全。

### 11.4 推荐实现：抽出 `applyUiScale`

新建 `src/utils/applyUiScale.ts`（避免 `uiScale.ts` 绑 DOM）：

```ts
import { clampUiScale } from "./uiScale";
import type { RendererPlatform } from "./rendererPlatform";

export type ApplyUiScaleTarget = {
  root: HTMLElement;
  setNativeZoom?: (factor: number) => Promise<void>;
  platform: RendererPlatform;
};

function usesCssPageZoom(platform: RendererPlatform): boolean {
  // 仅 Windows（及 unknown 保守）用 CSS 承载缩放。
  // macOS / Linux 用 native，见 §10。
  return platform === "windows" || platform === "unknown";
}

export async function applyUiScale(
  scale: number,
  target: ApplyUiScaleTarget,
): Promise<void> {
  const next = clampUiScale(scale);

  if (usesCssPageZoom(target.platform)) {
    target.root.style.zoom = String(next);
    target.root.style.setProperty("--ui-scale", String(next));
    if (target.setNativeZoom) {
      // 钉死 WebView2 ZoomFactor，避免残留非 1 与 CSS 叠乘
      await target.setNativeZoom(1);
    }
    return;
  }

  // macos / linux：native page/zoom_level
  target.root.style.zoom = "";
  target.root.style.setProperty("--ui-scale", String(next));
  if (target.setNativeZoom) {
    await target.setNativeZoom(next);
  }
}
```

**为何不用 `transform: scale`：** 不参与布局，滚动/命中易错；CSS `zoom` 在 Chromium 更接近整页缩放。

**为何 Linux 不进 `usesCssPageZoom`：** 见 §10.2–10.6。

### 11.5 改 `useUiScaleShortcuts.ts` effect

**当前（有害，约 37–52 行）：**

```ts
void getCurrentWebview().setZoom(uiScale).catch(() => undefined);
```

**改为：**

```ts
useEffect(() => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const platform = detectRendererPlatform();

  let setNativeZoom: ((factor: number) => Promise<void>) | undefined;
  try {
    const webview = getCurrentWebview();
    setNativeZoom = (factor) => webview.setZoom(factor);
  } catch {
    // 非 Tauri / 无 metadata（保留 84c6481e0 防护意图）
    setNativeZoom = undefined;
  }

  void applyUiScale(uiScale, {
    root: document.documentElement,
    setNativeZoom,
    platform,
  }).catch(() => undefined);
}, [uiScale]);
```

**硬性约束：**

- Windows：`setNativeZoom` 的参数 **只能是 `1`**（由 `applyUiScale` 保证），**禁止** `setZoom(uiScale)` 且 uiScale≠1。  
- 不要在此 effect 里写回 settings / 不要把用户 scale 改成 1。

### 11.6 备选（非默认）

| 方案 | 何时用 |
|------|--------|
| B. Windows 强制 UI 100% | 只要止血、可接受功能回退 |
| C. Linux 也改 CSS | **仅当** Linux 实机复现同类 hang 并更新本文证据后 |
| D. 全平台 CSS | 产品明确要求三端像素级一致，并接受 Mac 回归测试成本 |

### 11.7 测试

**`useUiScaleShortcuts.test.tsx`**

| 用例 | mock platform | uiScale | 期望 |
|------|---------------|---------|------|
| Win CSS | `windows` | 1.1 | `setZoom` 调用参数为 **1**；`documentElement.style.zoom` 为 `"1.1"`（或与 clamp 一致） |
| Mac native | `macos` | 1.1 | `setZoom(1.1)`；`style.zoom` 为 `""` |
| Linux 同 Mac | `linux` | 1.1 | 同 Mac：`setZoom(1.1)` |
| 非 Tauri | getCurrentWebview throw | 1.1 | hook 不抛；Win/unknown 仍可设 CSS |
| 回归 | 任意 | — | getCurrentWebview 同步 throw 不进 ErrorBoundary |

mock：

```ts
vi.mock("../../../utils/rendererPlatform", () => ({
  detectRendererPlatform: () => mockPlatform,
}));
```

**`applyUiScale.test.ts`（建议）** 表驱动四平台 × 两档 scale。

### 11.8 手工验收矩阵

#### Windows（必做）

系统显示缩放 **100% 与 125% 各一轮**。

| # | 前置 | 操作 | 期望 |
|---|------|------|------|
| W1 | `uiScale:0.8` | 冷启动 | ≤10s 可交互；有 `render-committed`；内存不狂涨 |
| W2 | `uiScale:1` | 冷启动 | 正常 |
| W3 | `uiScale:1.2` | 冷启动 | 正常且视觉偏大 |
| W4 | 任意 | 快捷键缩放到 80% 再放大 | 不假死 |
| W5 | 任意 | 重置 100% | 回 100% |
| W6 | 旧版曾 setZoom(0.8) 的用户数据 | 升级后首次启动 | 不挂；无双重放大（native 已钉 1） |
| W7 | `uiScale:0.8` | 拖拽分栏 / 标题栏 | 可拖、无错位到不可用 |

#### macOS（必做冒烟）

| # | 操作 | 期望 |
|---|------|------|
| M1 | `uiScale:0.8` 冷启动 | 正常启动，界面约 80% |
| M2 | 快捷键 ± / 重置 | 正常 |
| M3 | 确认未误设 CSS zoom 导致「比预期更小/更大」 | native 单一路径 |

#### Linux（有环境必做，无环境写 PR「未测」）

| # | 操作 | 期望 |
|---|------|------|
| L1 | `uiScale:0.8` 冷启动 | 正常（native `set_zoom_level`） |
| L2 | 快捷键缩放 | 正常 |
| L3 | 若 L1 假死/爆内存 | **停用默认策略**，改走 CSS，并回写本文 §0/§10 证据 |

### 11.9 实现勾选清单

- [ ] 1. 新增 `applyUiScale` + 单测（四平台表）  
- [ ] 2. 改 `useUiScaleShortcuts` effect（§11.5）  
- [ ] 3. 更新 hook 单测（Win/Mac/Linux/throw）  
- [ ] 4. vitest + typecheck  
- [ ] 5. Windows §11.8 W1/W3/W4/W7（125% DPI）  
- [ ] 6. macOS M1/M2  
- [ ] 7. Linux L1/L2 或注明未测  
- [ ] 8. PR 贴 §11.3 策略表 + 手测结果 + 链到本文 §0  

**Commit 建议：**

```text
fix(ui): 修复 Windows 非 100% 界面缩放导致启动假死

Windows 用 CSS zoom 应用 uiScale，并把 WebView2 ZoomFactor 钉为 1；
macOS/Linux 保持 native setZoom，避免无证据的跨平台行为漂移。
```

### 11.10 风险与回滚

| 风险 | 平台 | 缓解 |
|------|------|------|
| CSS zoom 与 fixed/拖拽/canvas | Win | W7 手测；出问题再针对性修坐标 |
| 旧 ZoomFactor 残留 | Win | 每次 apply `setZoom(1)` |
| `setZoom(1)` 本身异常 | Win | 极低概率；catch 吞掉且 CSS 已生效 |
| Linux 其实也 hang | Linux | L 矩阵发现后切 CSS，更新文档 |
| Mac 被误判为 windows | Mac | 依赖 `detectRendererPlatform`；单测锁分支 |
| 回滚 | 全 | 回退 effect + `applyUiScale` 即可；无需 migration |

### 11.11 不要做的事

1. Windows 上继续 `setZoom(uiScale)` 只加 timeout。  
2. 无 Linux 证据把 Linux 并进 CSS 分支「图省事」。  
3. 静默改写用户 `uiScale` 为 1 并 save。  
4. 在 `bootstrapApp`/`main.tsx` 抢跑 settings 调 zoom。  
5. 整文件重写 `useUiScaleShortcuts`。  
6. 用 `isWindowsPlatform()` 作为唯一探测且不管 linux/mac 细分。  

### 11.12 文件清单

| 文件 | 动作 |
|------|------|
| `src/features/layout/hooks/useUiScaleShortcuts.ts` | **必改** |
| `src/features/layout/hooks/useUiScaleShortcuts.test.tsx` | **必改** |
| `src/utils/applyUiScale.ts` | **新建（建议）** |
| `src/utils/applyUiScale.test.ts` | **新建（建议）** |
| `src/utils/rendererPlatform.ts` | 只读复用 |
| `src/utils/uiScale.ts` | 只读复用 `clampUiScale` |
| `src/features/app/hooks/useAppSettingsController.ts` | 通常不改 |
| `src-tauri/**` | 本任务不改 |

---

**开发完成定义：** §11.9 勾完 + §11.8 Windows 125% 至少 W1/W3/W4 通过 + macOS 冒烟 + 单测绿。
