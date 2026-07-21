# markdown-mermaid-block-fullscreen-viewer Specification

## Purpose

Defines the contract for entering a fullscreen viewer on Markdown Mermaid blocks across both messages and file-preview surfaces, reusing `viewerjs@^1.11.7` with a shared singleton lifecycle, theme-aware chrome, panel-lock teardown, and strict a11y/i18n entry semantics.

## Requirements

### Requirement: Markdown Mermaid Block MUST Expose Fullscreen Entry

Markdown Mermaid 图块在 `MermaidBlock`（消息侧）与 `FileMarkdownMermaidBlock`（文件预览侧）两块实现里 MUST 在顶部 actions 区暴露一个 icon-only 全屏入口按钮，按钮 `title` 与 a11y 标签 MUST 使用 i18n。按钮 MUST 仅在 SVG 已成功渲染时启用，Source tab / 渲染中 / 错误状态下 MUST 处于 disabled。

#### Scenario: 消息侧 Mermaid 块在 SVG 已就绪时出现全屏按钮

- **WHEN** `MermaidBlock` 的 `renderState.status === "success"`
- **THEN** header `.markdown-mermaidblock-actions` 内 MUST 出现一个 type=button 的全屏入口
- **AND** 按钮子节点 MUST 仅渲染 `Maximize2` 图标，不渲染可见文案
- **AND** 按钮 MUST NOT 处于 disabled
- **AND** 按钮 `aria-label` MUST 为 `t("common.markdownMermaidFullscreenHint")` 的值
- **AND** 按钮 `title` MUST 为 `t("common.markdownMermaidFullscreen")` 的值（zh: "全屏"，en: "Fullscreen"）
- **AND** i18n key MUST 归 `common.*` 命名空间，与 files 侧复用同一 key

#### Scenario: 消息侧 Mermaid 块在非成功状态下按钮 disabled

- **WHEN** `MermaidBlock` 的 `renderState.status` 为 `idle` / `rendering` / `error`
- **THEN** 全屏入口按钮 MUST 处于 disabled
- **AND** 按钮 MUST NOT 触发全屏 viewer

#### Scenario: 文件预览侧 Mermaid 块在 Source tab 时按钮 disabled

- **WHEN** `FileMarkdownMermaidBlock` 的 `activeTab === "source"`
- **THEN** header `.fvp-file-markdown-codeblock-label` 内 MUST 出现一个 type=button 的全屏入口
- **AND** 按钮 MUST 处于 disabled
- **AND** 按钮 MUST NOT 触发全屏 viewer

#### Scenario: 文件预览侧 Mermaid 块在 Render tab 且 SVG 就绪时按钮 enabled

- **WHEN** `FileMarkdownMermaidBlock` 的 `activeTab === "render"` 且 `visibleSvg` 非空
- **THEN** 全屏入口按钮 MUST NOT 处于 disabled
- **AND** 按钮 `aria-label` MUST 为 `t("common.markdownMermaidFullscreenHint")` 的值

#### Scenario: 全屏入口按钮不破坏现有 actions 顺序

- **WHEN** 任意一个 Mermaid 块渲染时
- **THEN** 现有 actions 顺序 MUST 保持：消息侧 `[Source/Preview][Copy][CopyFenced][Fullscreen]`；文件预览侧 `[Source tab][Render tab][Fullscreen]`
- **AND** 新增按钮 MUST NOT 删除或重排现有按钮

### Requirement: Mermaid Fullscreen Viewer MUST Use Viewerjs Single-Image Configuration

`MermaidFullscreenViewer` MUST 使用 `viewerjs@^1.11.7` 的单图全屏配置：容器挂到 `document.body`，navbar / title 关闭，toolbar 严格配置为 8 个按钮（zoomIn / zoomOut / oneToOne / reset / rotateLeft / rotateRight / flipHorizontal / flipVertical），prev / next / play 显式置 false。toolbar 按钮位置 MUST 严格按 toolbar 对象 key 声明顺序展示（viewerjs 1.11.x ToolbarOption 不支持 5-9 的位置数字，只能按对象 key 升序排列）。Mermaid SVG 在进入 `<img>` 前 MUST 从 HTML-compatible markup 规范化为 XML-safe serialization，同时保持 strict sanitization；normalization MUST NOT 在 React render path 执行，且相同 component instance 的相同 SVG MUST 复用 bounded cached Data URL。

#### Scenario: 工具条按钮集合严格匹配 yn 单图用法

- **WHEN** `MermaidFullscreenViewer` 打开
- **THEN** viewerjs 实例 MUST 通过 `new Viewer(img, { container: document.body, inline: false, navbar: false, title: false, transition: !reducedMotion, toolbar: { zoomIn: true, zoomOut: true, oneToOne: true, reset: true, rotateLeft: true, rotateRight: true, flipHorizontal: true, flipVertical: true, prev: false, next: false, play: false } })` 创建
- **AND** 全屏 DOM 中 `.viewer-toolbar > ul` 的 `li` 子元素数量 MUST 等于 8
- **AND** toolbar 列表项中 MUST NOT 出现 prev / next / play 对应的 li
- **AND** toolbar 列表项位置顺序 MUST 与 toolbar 对象 key 声明顺序一致：zoomIn → zoomOut → oneToOne → reset → rotateLeft → rotateRight → flipHorizontal → flipVertical

#### Scenario: viewerjs 容器挂到 document.body 且 z-index 通过 CSS 变量暴露

- **WHEN** `MermaidFullscreenViewer` 打开
- **THEN** viewerjs 容器 MUST 是 `document.body` 的直接子节点
- **AND** viewerjs 容器 z-index MUST ≥ `var(--z-mermaid-fullscreen, 1300)`
- **AND** `--z-mermaid-fullscreen` MUST 定义于 `:root`，默认值为 1300（高于现有 `kanban.css: z-index: 1200` 留 100 buffer）
- **AND** viewerjs 容器 z-index MUST 高于项目内所有现有 z-index 硬编码值

#### Scenario: SVG 通过 XML-safe serialization 与 UTF-8 Base64 注入 img

- **WHEN** `MermaidFullscreenViewer` 收到非空 `svg` 字符串
- **THEN** viewerjs 持有的元素 MUST 是一个 `<img>` 标签
- **AND** Mermaid strict-sanitized SVG MUST 先通过 inert HTML parser 恢复 DOM namespace，再由 `XMLSerializer` 输出 XML-safe markup
- **AND** HTML void elements（包括 `<br>`、`<hr>`、`<img>`、`<input>`、`<wbr>`）MUST 在最终 SVG 中成为 XML-safe serialization
- **AND** HTML named entity（包括 `&nbsp;`）MUST NOT 以 XML 未定义 entity 留在最终 SVG 中
- **AND** `<img>` 的 `src` MUST 是 `data:image/svg+xml;base64,${base64(xmlSafeSvg)}` 形态
- **AND** `base64(xmlSafeSvg)` MUST 通过 `TextEncoder.encode(xmlSafeSvg)` → `btoa()` 流程生成（UTF-8 安全）
- **AND** `<img>` MUST 显式带 `alt=""` 与 `aria-hidden="true"`（a11y 装饰性图）
- **AND** viewerjs MUST NOT 直接接管 `<svg>` DOM 节点作为主路径
- **AND** 规范化环境能力缺失或无法取得 `<svg>` root 时 MUST 回退原始 SVG UTF-8 Base64 编码且不得抛出新异常
- **AND** serialization exception MUST 回退原始 SVG UTF-8 Base64、产生不包含 SVG source 的 diagnostic，并且不得向 caller 抛出

#### Scenario: Data URL normalization 离开 render 并按 SVG 复用

- **WHEN** fullscreen 以 SVG A 打开
- **THEN** React render MUST NOT 执行 `svgToDataUrl`
- **AND** viewer lifecycle effect MUST 在 `ViewerCtor` 绑定 `<img>` 前为其设置 SVG A 的 Data URL
- **AND** parent rerender 或关闭后 reopen SVG A MUST 复用 component-local cached Data URL
- **AND** cache MUST 只保留最近一个 SVG/Data URL entry
- **WHEN** 同一 component instance 随后打开 SVG B
- **THEN** lifecycle effect MUST 为 SVG B 恰好重新计算一次并覆盖旧 cache

#### Scenario: 含 XHTML 换行的流程图可全屏解码

- **WHEN** Mermaid flowchart node label 包含 `<br/>` 并在 strict sanitization 后输出 `<foreignObject>` XHTML
- **THEN** fullscreen Data URL MUST 可被 XML parser 接受
- **AND** `<img>` MUST 触发 load 而不是 error
- **AND** 截图对应的多节点流程图与小型含换行流程图 MUST 使用同一 normalization path

#### Scenario: Unicode label 在规范化后保持正确

- **WHEN** Mermaid SVG 包含中文、日文或 Emoji label
- **THEN** XML-safe serialization MUST 保留原字符
- **AND** UTF-8 Base64 decode 后 MUST 与 serialization 输入一致

#### Scenario: reduced-motion 用户群体不带过渡动画

- **WHEN** `window.matchMedia("(prefers-reduced-motion: reduce)").matches === true`
- **THEN** viewerjs options MUST 传 `transition: false`
- **WHEN** reduced-motion 未启用
- **THEN** viewerjs options MUST 传 `transition: true`（viewerjs 默认）

### Requirement: Mermaid Fullscreen Viewer MUST Explicitly Call viewer.show() In Modal Mode

`MermaidFullscreenViewer` MUST 在 `new ViewerCtor(img, options)` 之后立即调用 `viewer.show()`。原因: viewerjs 1.11.x 的 modal 模式(`inline: false`)下, 构造器不自动调 `show()`,它仅在 `init` 末尾给 bound element 挂 click 监听 (`node_modules/viewerjs/dist/viewer.js` line ~3020-3035 的 `addListener(element, EVENT_CLICK, this.onStart = ...)`),等用户点击触发 `view()`→`show()`。由于本组件是 button-driven (用户点 actions 区 Maximize2 按钮) 而非 click-on-img-driven, 必须手动 `viewer.show()`,否则 viewerjs backdrop / toolbar 永不出现。

#### Scenario: 构造 viewer 后立刻 show()

- **WHEN** `MermaidFullscreenViewer` 在 `open=true` 且 `svg` 非空时构造 viewerjs 实例
- **THEN** 该代码路径 MUST 在 `new ViewerCtor(imgRef.current, options)` 之后、注册任何 observer 之前, 同步调用 `viewer.show()` 至少一次
- **AND** `viewer.show()` MUST NOT 被 `cancelled` flag 拦截(取消检查在 show 之前已完成)
- **AND** 若 `cancelled` 在 `show()` 之后才变 true, `MermaidFullscreenViewer` cleanup 函数 MUST 在 `viewer.destroy()` 之后, 保留对 viewer 实例的引用以避免 GC 提前回收

#### Scenario: 第二次进入全屏也能成功打开

- **WHEN** 全屏 viewer 已通过 ESC 关闭 (`hidden` 事件触发 `onClose`, 父组件 `isFullscreenOpen` 回到 false)
- **AND** 用户再次点击全屏按钮
- **THEN** `MermaidFullscreenViewer` 重新走完整 `new ViewerCtor` + `viewer.show()` 链路
- **AND** 第二次 viewer 的 backdrop / toolbar 正常出现
- **AND** body 下 MUST NOT 同时存在多个 `.viewer-container` 节点(单例保证)

### Requirement: Mermaid Fullscreen Viewer MUST Cleanup On Close

`MermaidFullscreenViewer` MUST 在用户触发关闭（ESC / 点击 backdrop / 显式调用 `onClose`）或组件 unmount 时调用 `viewer.destroy()`，并保证父组件的 `isFullscreenOpen` state 同步回归 false，不留 stale DOM 引用。

#### Scenario: ESC 与 backdrop 点击触发 hidden 事件 → onClose

- **WHEN** 用户在全屏 viewer 中按下 ESC
- **THEN** viewerjs MUST 触发 `hidden` 事件
- **AND** `MermaidFullscreenViewer` MUST 调用 `onClose`
- **AND** 父组件 `isFullscreenOpen` state MUST 同步为 false
- **AND** `.viewer-backdrop` 元素 MUST 从 DOM 中消失

- **WHEN** 用户点击全屏 viewer 的 backdrop
- **THEN** viewerjs MUST 触发 `hidden` 事件
- **AND** `MermaidFullscreenViewer` MUST 调用 `onClose`
- **AND** `.viewer-backdrop` 元素 MUST 从 DOM 中消失

#### Scenario: 组件 unmount 时强制 viewer.destroy

- **WHEN** `MermaidFullscreenViewer` 在 `open=true` 状态下 unmount（例如父组件 setState 把 `isFullscreenOpen` 设为 false）
- **THEN** React useEffect cleanup MUST 调用 `viewer.destroy()`（try/catch 兜底）
- **AND** DOM 中 MUST NOT 残留任何 `.viewer-backdrop` / `.viewer-toolbar` / `.viewer-container` 节点

#### Scenario: 连续打开/关闭不残留 DOM 与内存泄漏

- **WHEN** 用户连续打开/关闭 Mermaid 全屏 viewer 50 次
- **THEN** DOM 中 viewerjs 节点累计数量 MUST 保持 0
- **AND** DevTools Memory 面板中 detached DOM 节点 MUST NOT 持续增长

#### Scenario: React 18 StrictMode dev 双 mount 不导致双 viewer

- **WHEN** `MermaidFullscreenViewer` 在 React 18 StrictMode 下渲染
- **THEN** useEffect MUST 通过 `cancelled` 标志在 StrictMode 第二次 mount 之前取消第一次的 viewer 创建
- **AND** DOM 中 viewerjs 节点累计 MUST ≤ 0（即使 dev 双调用）
- **AND** 实际 viewer 实例数量 MUST 为 1

### Requirement: Mermaid Fullscreen Viewer MUST Be Cross-Surface Shared With Singleton Guarantee

`MermaidFullscreenViewer` MUST 作为 `MermaidBlock`（消息侧）与 `FileMarkdownMermaidBlock`（文件预览侧）共用的共享组件，组件位置 MUST 在 `src/features/markdown/mermaidFullscreen/`，两处 feature MUST NOT 互相 import。同一时刻 MUST 至多存在一个 viewer 实例。

#### Scenario: 共享组件入口可被两个 surface 引用

- **WHEN** `src/features/messages/components/MermaidBlock.tsx` 与 `src/features/files/components/FileMarkdownPreview.tsx` 都需要使用全屏 viewer
- **THEN** 两处 MUST 通过 `import { MermaidFullscreenViewer } from "@/features/markdown/mermaidFullscreen"`（或等价相对路径）引用
- **AND** `src/features/markdown/mermaidFullscreen/` 目录 MUST 存在 `MermaidFullscreenViewer.tsx` / `index.ts` / `svgToDataUrl.ts` / `activeViewer.ts` / `preloadViewerjs.ts` 共 5 个文件
- **AND** `MermaidFullscreenViewer` 内部 MUST NOT 直接 import 任何 messages / files 下的具体组件

#### Scenario: messages 与 files 互相不直接 import

- **WHEN** 检查 `src/features/messages/` 与 `src/features/files/` 之间的 import 关系
- **THEN** `src/features/messages/` MUST NOT import 任何 `src/features/files/` 下的具体组件
- **AND** `src/features/files/` MUST NOT import 任何 `src/features/messages/` 下的具体组件
- **AND** 两处 Mermaid 块的 fullscreen 集成 MUST 完全通过 `src/features/markdown/mermaidFullscreen/` 共享

#### Scenario: 同一时刻最多一个 Mermaid 全屏 viewer

- **WHEN** 消息侧 Mermaid 块打开全屏 viewer
- **AND** 用户随后在文件预览侧 Mermaid 块点击 Fullscreen
- **THEN** 第一个 viewer MUST 被 `destroy()` 并从 DOM 移除
- **AND** 第二个 viewer MUST 正常打开
- **AND** module-level `getActiveViewer()` 在任意时刻 MUST 至多返回一个非 null viewer

#### Scenario: panel-lock 开启时 viewer 主动关闭

- **WHEN** 全屏 viewer 已打开
- **AND** `document.body` 下出现 `.panel-lock-overlay` 节点
- **THEN** `MermaidFullscreenViewer` MUST 调用 `viewer.destroy()`
- **AND** `MermaidFullscreenViewer` MUST 调用 `onClose`
- **AND** 父组件 `isFullscreenOpen` state MUST 同步为 false

### Requirement: Mermaid Fullscreen Viewer MUST Sync Theme Switching

`MermaidFullscreenViewer` MUST 在主题切换（dark ↔ light）期间自动调 `viewer.update()`，让 viewerjs 重新读取主题色变量。

#### Scenario: 主题变化触发 viewer.update

- **WHEN** 全屏 viewer 已打开
- **AND** `document.documentElement` 的 theme mutation（dark / light 切换）发生
- **THEN** `MermaidFullscreenViewer` MUST 调用 `viewer.update()`
- **AND** viewerjs 内部 backdrop / toolbar 主题色 MUST 跟随主应用主题切换
- **AND** 组件 unmount 时 MUST disconnect MutationObserver

### Requirement: Mermaid Fullscreen Backdrop MUST Frost Per Theme

`MermaidFullscreenViewer` 打开时, viewerjs backdrop 元素 (`.viewer-backdrop`) MUST 应用 `backdrop-filter: blur(...) saturate(...)` 让背景内容产生 frosted glass 效果, 而非单纯半透明实色。blur 半径与 tint 浓度 MUST 按 `data-theme` 区分 (light 偏亮需要更强 blur, dim / 默认 dark 偏暗用中等 blur), 同时 MUST 兼容 `prefers-reduced-motion: reduce` 用户将 blur 关闭。

#### Scenario: 三主题分别有独立的 backdrop 模糊半径与 tint

- **WHEN** 全屏 viewer 打开且 `document.documentElement` 的 `data-theme` 分别为 `light` / `dim` / (空)
- **THEN** light 主题下 `.viewer-backdrop` 的 `backdrop-filter` 模糊半径 MUST ≥ 16px, tint 浓度 MUST ≤ 75%
- **AND** dim 主题下 MUST ≥ 14px, tint 浓度 MUST ≤ 80%
- **AND** 默认 (深色) 主题下 MUST ≥ 12px, tint 浓度 MUST ≤ 85%
- **AND** 模糊半径与 tint MUST 通过 CSS 变量 (`:root` + `:root[data-theme="..."]`) 暴露, 不直接 hard-code 在 `.viewer-backdrop` 选择器中

#### Scenario: prefers-reduced-motion 用户 blur 关闭

- **WHEN** `window.matchMedia("(prefers-reduced-motion: reduce)").matches === true`
- **THEN** `--mermaid-fullscreen-blur` MUST 被覆写为 `0px`
- **AND** `.viewer-backdrop` 实际生效的 `backdrop-filter` MUST 等价于无 blur
- **AND** tint 颜色 MUST 仍生效 (避免用户看到一个"什么都没变"的视图)

#### Scenario: toolbar 同步带 blur

- **WHEN** 全屏 viewer 打开
- **THEN** `.viewer-toolbar` MUST 应用 `backdrop-filter: blur(12px) saturate(1.2)`, 与 backdrop 风格统一
- **AND** toolbar 自身 background MUST 来自 `--mermaid-fullscreen-toolbar-bg`
- **AND** toolbar `> ul > li` 默认背景 MUST 来自 `--mermaid-fullscreen-toolbar-item-bg`, hover 状态来自 `--mermaid-fullscreen-toolbar-item-hover-bg`

### Requirement: Mermaid Fullscreen Toolbar And Close Button MUST Follow Theme Tokens

viewerjs 内部 toolbar 与右上角关闭按钮的图标都是单张白填充 SVG sprite (data URL),`color` 无法到达 path 填充。MUST 不替换 sprite 本身 (那样需要复制 sprite + 处理 mask 偏移,易踩坑),而 MUST 用 CSS `filter` (per-theme `--mermaid-fullscreen-icon-filter` token) 在 `::before` 上做主题反色。toolbar 与 close button MUST 使用 Mermaid fullscreen 专属控件变量, light / dim / dark 分别覆盖，禁止浅色系继续复用 dark 的 `surface-overlay` 控件色。

#### Scenario: toolbar 图标按主题反色 (filter 而非 mask)

- **WHEN** 全屏 viewer 打开
- **THEN** `.viewer-toolbar > ul > li::before` MUST 仅应用 `filter: var(--mermaid-fullscreen-icon-filter)`,不替换 `background-image` / `background-position`
- **AND** 默认 (深色) 主题下 `--mermaid-fullscreen-icon-filter` MUST 为 `none` (viewerjs 原 sprite 白填充直接显示)
- **AND** `:root[data-theme="light"]` MUST 把 token 切到 `invert(1) brightness(0.85)` (白底 → 黑)
- **AND** `:root[data-theme="dim"]` MUST 把 token 切到 `invert(1) brightness(0.9)`
- **AND** 8 个 enabled 按钮 (zoomIn / zoomOut / oneToOne / reset / rotateLeft / rotateRight / flipHorizontal / flipVertical) MUST 在切换主题后全部可读,无 1 个 icon 不可见

#### Scenario: 右上角关闭按钮默认态有清晰视觉边界

- **WHEN** 全屏 viewer 打开且用户没有 hover / focus `.viewer-button`
- **THEN** `.viewer-button` 背景 MUST 来自 `--mermaid-fullscreen-button-bg` (默认 `var(--surface-overlay)`)
- **AND** `.viewer-button` MUST 有 1px 实色边框 `var(--mermaid-fullscreen-button-border)`, 让关闭按钮在不同主题 backdrop 上不融入背景
- **AND** `.viewer-button::before` MUST 应用相同的 `--mermaid-fullscreen-icon-filter`,让 close icon 跟随主题色
- **AND** `:hover` / `:focus` MUST 改用 `var(--mermaid-fullscreen-button-hover-bg)` 背景,边框保持 (不要叠加 outline 与 border)

#### Scenario: light / dim 控件色必须独立于 dark

- **WHEN** `document.documentElement` 的 `data-theme` 为 `light`
- **THEN** `:root[data-theme="light"]` MUST 定义独立的 `--mermaid-fullscreen-button-bg` / `--mermaid-fullscreen-button-border` / `--mermaid-fullscreen-toolbar-bg` / `--mermaid-fullscreen-toolbar-item-bg`
- **AND** light 控件底色 MUST 使用浅色半透明值, close icon MUST 通过 `--mermaid-fullscreen-icon-filter` 反成深色
- **WHEN** `data-theme` 为 `dim`
- **THEN** `:root[data-theme="dim"]` MUST 定义一组区别于 light 与 dark 的 dim 控件底色
- **AND** dim 控件色 MUST 比 light 更收敛, 但不得回退到 dark 的 `surface-overlay` / `surface-hover` 共用值

### Requirement: Mermaid Fullscreen Theme MUST Follow Mossx CSS Variables

viewerjs 自身 CSS MUST 在 `loadMermaidFullscreenStyles()` 中按需 dynamic import 一次，主题色覆盖 MUST 通过现有 CSS 变量（`--surface-base` / `--surface-overlay` / `--text-faint` / `--text-default` / `--surface-hover`）实现，不引入与现有 design system 不一致的硬编码颜色。

#### Scenario: viewerjs 主题色覆盖

- **WHEN** 全屏 viewer 出现
- **THEN** `.viewer-backdrop` 背景 MUST 为 `color-mix(in srgb, var(--surface-base) 80%, transparent)` 形态 (默认深色主题; light 主题 70%; dim 主题 76%); MUST 应用 `backdrop-filter: blur(var(--mermaid-fullscreen-blur))` (默认 14px; light 18px; dim 16px)
- **AND** `.viewer-toolbar` 背景 MUST 为 `--mermaid-fullscreen-toolbar-bg`，并按 light / dim / dark 分主题覆盖
- **AND** `.viewer-toolbar > ul > li` 默认颜色 MUST 为 `var(--text-strong)` (驱动 currentColor 反色后的 icon 前景)
- **AND** `.viewer-toolbar > ul > li:hover` 颜色 MUST 为 `var(--text-default)`
- **AND** `.viewer-title` 颜色 MUST 为 `var(--text-faint)`
- **AND** `.viewer-navbar` 背景 MUST 为 `var(--surface-overlay)`（即便 navbar:false 也要兜底）
- **AND** `.viewer-button` (右上角关闭按钮) MUST 应用 `--mermaid-fullscreen-button-bg` 背景 + 1px `--mermaid-fullscreen-button-border` 边框, hover 切 `--mermaid-fullscreen-button-hover-bg` 背景

#### Scenario: viewerjs CSS 集中 import 一次

- **WHEN** 启动 dev server 或 build
- **THEN** `viewerjs/dist/viewer.css` MUST 通过 `loadMermaidFullscreenStyles()` 按需 dynamic import
- **AND** `src/styles/mermaid-fullscreen.css` MUST 在打包产物中仅出现一次
- **AND** viewerjs CSS MUST NOT 被 messages / files 任一组件 import 多次

#### Scenario: 首次渲染成功后 viewerjs 被预热

- **WHEN** `MermaidBlock` 或 `FileMarkdownMermaidBlock` 首次拿到 `renderState.svg === ...` 成功态
- **THEN** 该组件 MUST 调用 `void preloadViewerjs()` 一次
- **AND** `preloadViewerjs()` MUST 通过 module-level Promise 缓存，多次调用 MUST 仅触发 1 次 `import("viewerjs")`
- **AND** 用户点击 Fullscreen 时 MUST 不再需要等待 `import("viewerjs")` 完成

### Requirement: Mermaid Fullscreen Viewer MUST Be A11y Compliant

`MermaidFullscreenViewer` 内部 `<img>` MUST 显式带 `alt=""` + `aria-hidden="true"`（mermaid 是装饰性图，不是文档内容）。

#### Scenario: 装饰性 img 屏幕阅读器跳过

- **WHEN** 全屏 viewer 打开
- **THEN** viewer 内部的 `<img>` MUST 带 `alt=""` 属性
- **AND** viewer 内部的 `<img>` MUST 带 `aria-hidden="true"` 属性
- **AND** 屏幕阅读器 MUST 跳过该 `<img>` 的内容朗读


## 变更日志

### 2026-06-22 v1 (初版)
- 7 个 Requirement / 14 个 Scenario
- 全屏 + 8 按钮工具条 (boolean toolbar) + 销毁 + 单例 + 主题切换 + StrictMode + reduced-motion + panel-lock
- 9 个新建文件 + 8 个修改文件

### 2026-06-22 v2 (收口回写)
- v1 → v2 增量:
  1. `Mermaid Fullscreen Viewer MUST Explicitly Call viewer.show() In Modal Mode` (§12 修复) — 1 Requirement / 2 Scenario
  2. `Mermaid Fullscreen Backdrop MUST Frost Per Theme` (§13 主题适配) — 1 Requirement / 3 Scenario
  3. `Mermaid Fullscreen Toolbar And Close Button MUST Follow Theme Tokens` (§14 深色主题可见性) — 1 Requirement / 2 Scenario
- 累计: **10 个 Requirement / 29 个 Scenario**

### v2 失败经验 (决策痕迹, 留档)
- **mask-image 路径失败**: 第一轮想用 `mask-image` 替换 viewerjs 原 SVG sprite 让 icon 跟随 `currentColor`; 实测在 `background-size:280px` 缩放下 mask 偏移算错, 8 个 enabled 按钮有 1+ 个表现为"按钮组消失". **最终用 `filter: invert(1) brightness(...)` 反色, 保留 viewerjs 原 background-image 不动** (§14 / design.md Decision 12)
- **viewerjs 不自动 show()**: 1.11.7 modal 模式 (`inline: false`) 默认等用户点 bound img 触发 `view()`→`show()`. mossx 是 button-driven, **必须显式 `viewer.show()`**, 否则 backdrop 永不出现 (§12 / design.md Decision 11)

### 验收口径
- `npx tsc --noEmit` 退出码 0
- `npx vitest run <4 个 mermaid-fullscreen 相关文件>` 23/23 (6 + 1 + 3 + 13)
- `openspec validate 2026-06-22-add-mermaid-block-fullscreen-viewer --strict --no-interactive` 退出码 0
- 用户于 2026-06-22 dev 视觉验证三主题全屏 / 关闭按钮 / blur 强度 / i18n 切换, 反馈"目前功能都对 验收通过"
- code review 精准修复: `setActiveViewer(null)` 已加 ownership check，旧 viewer cleanup 不再清掉新 viewer 引用；新增回归测试覆盖跨 surface/双 viewer cleanup。
