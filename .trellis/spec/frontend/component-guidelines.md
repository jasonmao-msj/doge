# Component Guidelines（组件规范）

## 设计原则（Design Principles）

- 单一职责（Single Responsibility）优先：render / state orchestration / data mapping 分离。
- 默认使用 feature-local component，只有稳定复用后再提升到 `components/ui`。
- 大组件拆分时优先抽 hook 和 pure helper，不先抽“过度抽象”的 base component。

## 文件结构建议

1. imports（external -> internal）
2. local types
3. constants
4. pure helper
5. component implementation
6. export

## Props 约束

- 导出组件必须有明确 `Props` type/interface。
- 禁止无语义命名：`data/info/temp`。
- callback 使用 `onXxx`，并声明 payload type。
- nullable 字段显式写 `T | null`，避免隐式 optional。
- optional array/map/set props 不得在参数解构里写 `=[]` / `= new Set()` / `= new Map()`；使用 module-level `EMPTY_*` 常量，避免每次 render 生成新引用并触发 `useMemo/useEffect` 循环。

### Pattern: Wrapper-aware React Element Prop Injection

**Trigger**: 当已有代码用 `cloneElement(node, injectedProps)` 给外部构造好的 `ReactNode` 注入 props，且该 node 可能被 `Profiler` / provider / memo wrapper 包裹时。

**Contract**:
- 不得假设 `sidebarNode` / `composerNode` 等已构造 node 的 root element 就是真正消费 props 的组件。
- 如果要向 child-only wrapper 内的组件注入 prop，必须显式检查 `isValidElement(node.props.children)` 并把 prop 注入 child。
- 保留 wrapper 原有 props，例如 `Profiler id` / `onRender`；修复注入链路时不得移除 profiling / provider。
- 必须补 focused test，断言 wrapper child 的 props 收到注入值。

**Wrong**:

```tsx
const sidebarNodeWithTopbar = cloneElement(sidebarNode, { topbarNode });
```

如果 `sidebarNode` 实际是 `<Profiler><Sidebar /></Profiler>`，`topbarNode` 会写到 `Profiler` 上，`Sidebar` 收不到。

**Correct**:

```tsx
const props = sidebarNode.props as { children?: React.ReactNode };
const sidebarNodeWithTopbar = isValidElement(props.children)
  ? cloneElement(sidebarNode, {
      children: cloneElement(props.children, { topbarNode }),
    })
  : cloneElement(sidebarNode, { topbarNode });
```

**Tests Required**:
- 覆盖直接 `<Sidebar />` 注入路径。
- 覆盖 `<Profiler><Sidebar /></Profiler>` 注入路径，断言 child props 包含 `topbarNode`。

## Styling 规范

- 当前项目主样式是 `src/styles/*.css` + `className`/`cn()` 组合。
- class 前缀要 feature scoped（如 `git-history-*`、`spec-hub-*`）。
- 大样式文件允许分片 `*.part1.css/*.part2.css`，但必须保持 selector contract 稳定。
- 条件 class 建议复用 `src/lib/utils.ts` 的 `cn()`。

## Scenario: Shared Visual Primitive MUST Own Its Stylesheet

### 1. Scope / Trigger

- Trigger：把 visual shell / frame / card primitive 抽到 shared module，替换其 consumer，或让多个 sibling entry 复用同一组 CSS classes。
- 目标：consumer 替换不能让 JSX 仍存在、TypeScript/Vitest 全绿，但 production bundle 丢失 stylesheet side effect，导致 image/control 按 UA 默认尺寸渲染。

### 2. Signatures

- Shared owner：`SharedView.tsx` 直接 `import "./shared-view.css"`。
- Consumers：`LegacyEntry.tsx`、`NewEntry.tsx` 只 import shared component，不重复拥有 stylesheet side effect。
- Critical image：`<img className="feature-logo" width={N} height={N} ... />`，CSS 同步约束 `width/height/object-fit`。

### 3. Contracts

- 定义并渲染 feature-scoped visual classes 的最低 shared module MUST 导入对应 stylesheet；禁止把 import 留在任一 optional/legacy consumer。
- sibling consumers MUST NOT 各自复制 stylesheet import；bundler dedupe 不能替代明确 ownership。
- startup/gate/logo/avatar 等首屏关键图片 MUST 提供 intrinsic `width/height`，避免 CSS chunk 尚未 settle 时按原始 raster 尺寸产生 full-window flash。
- 将 SVG/data URL 替换为 PNG/JPEG/WebP 等 raster asset 时，最低 shared `<img>` owner MUST 同时提供 attribute intrinsic `width/height` 与 inline pixel `width/height`，并设置 `max-width/max-height: 100%`、`object-fit: contain`；wrapper MUST 有确定尺寸与 `overflow: hidden`。仅有 HTML attribute 不足以对抗 `.wrapper img { width:100%; height:100% }` 等 author CSS，禁止只在某个 optional consumer stylesheet 限尺寸。
- consumer replacement review MUST 搜索 `import "*.css"` propagation；JSX/type import 可达不代表 CSS side effect 可达。
- jsdom unit tests 不能作为 layout evidence；可见 startup shell 还 MUST 做 exact current flavor 的 Tauri visual smoke。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| Legacy + Product entry 复用 frame | shared view 唯一导入 CSS，两条入口均有样式 | CSS 只挂在 Legacy entry |
| Product entry 替换 Router owner | bundle graph 仍从 shared view reach stylesheet | JSX 正常但 logo 原图铺满窗口 |
| CSS 尚未下载/热更新 | intrinsic image size 保持 layout bounded | 首屏按 raster natural size 闪烁 |
| jsdom tests 全绿 | 继续执行 static import contract + real visual smoke | 将 jsdom 当作 CSS layout 验收 |

### 5. Good / Base / Bad Cases

- Good：`AccountAppGateViews.tsx` owns `account-app-gate.css`；legacy/product gates 只 import shared views；logo 同时声明 `54×54` intrinsic size。
- Base：single-consumer leaf component 可自行拥有同目录 stylesheet；一旦抽成 sibling-shared owner，stylesheet 随 owner 迁移。
- Bad：新 Router 改用 `ProductGate`，但 stylesheet 仍只由不再挂载的 `LegacyGate` 导入。

### 6. Tests Required

- Static visual contract MUST assert shared owner contains exact stylesheet import，所有 sibling consumers 不再承担该 import。
- Static/component contract MUST assert critical raster image 包含 bounded intrinsic dimensions。
- Shared raster primitive component test MUST 同时断言 intrinsic attributes、inline pixel size 与 wrapper clipping；至少使用一个大尺寸 fixture，避免 natural size 或 consumer `width:100%` override 被 jsdom 结构测试遗漏。
- Manual smoke MUST 使用当前 source 编译出的 exact app flavor；旧 `.app` / 自动启动的同名 bundle 不能作为 evidence。

### 7. Wrong vs Correct

#### Wrong

```tsx
// LegacyGate.tsx
import "./account-app-gate.css";
import { GateFrame } from "./AccountAppGateViews";

// ProductGate.tsx renders GateFrame but never reaches the stylesheet.
```

#### Correct

```tsx
// AccountAppGateViews.tsx
import "./account-app-gate.css";

export function GateFrame({ children }: Props) {
  return <main className="account-app-gate">{children}</main>;
}
```

## i18n 规范

- 用户可见文案必须走 `useTranslation().t("...")`。
- 禁止在交互界面硬编码 copy（调试日志除外）。
- 文案 key 变更要同步 `src/i18n/locales/*`。

## Accessibility 基线

- button/input 必须有可访问名称（label/aria-label/title）。
- modal/dialog 必须具备 `role="dialog"` + `aria-modal`（若为 modal）。
- 鼠标可操作项需考虑 keyboard path。

## Scenario: Git File List Selection Surface

### 1. Scope / Trigger

- Trigger：修改 `src/features/git/components/GitDiffPanel*`、`src/features/git-history/components/GitHistoryWorktreePanel.tsx`、`src/styles/diff.css` 或 `src/styles/git-history*.css` 中的 Git changed-file list / worktree file list。
- 目标：Hub Git 文件列表与外部 Git worktree 文件列表保持同一视觉契约，避免 status、filename、checkbox 在 narrow panel 中漂移成两行或语义混用。

### 2. Signatures

- Hub 文件行：`DiffFileRow({ file, section, inclusionState, treeItem, showDirectory, onSetCommitSelection })`
- 提交范围控件：`InclusionToggle({ state, label, onToggle, disabled?, stopPropagation? })`
- 外部参考行：`GitHistoryWorktreePanel` 的 `.git-history-worktree-file-row`
- 样式契约：`.diff-row.git-filetree-row` MUST use four grid columns: `status / icon / path / meta`。

### 3. Contracts

- `DiffFileRow` 的直接 children 顺序 MUST 为：`.diff-status-letter`、`.diff-file-icon`、`.diff-file`、`.diff-row-meta`。
- `.diff-status-letter` MUST be read-only visual status. It MUST NOT be a commit selection button and MUST NOT live inside `.diff-row-meta`。
- commit selection MUST use `InclusionToggle` with `role="checkbox"` and an accessible label from `git.commitSelectionToggleFile` or `git.commitSelectionToggleScope`。
- `.diff-row-meta` MUST contain only row actions, stats-like metadata, and commit selection controls; it MUST stay in the rightmost grid column and use nowrap semantics.
- `tree` mode rows MUST keep the same file row contract as `flat` mode. Tree indentation can be applied by row padding/CSS variables, but MUST NOT introduce a second status line.
- When repository root is known in tree mode, the root folder row SHOULD remain visible so the hierarchy mirrors the external Git file structure.
- Selection controls MUST stop propagation so clicking checkbox does not select/open the file row.

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| Hub flat list | `status / icon / filename + dir / meta + checkbox` 同一行 | `(U)/(A)/(M)` 单独占一行 |
| Hub tree list | folder hierarchy visible; file row remains four-column | tree file row 使用不同 DOM 顺序导致样式 drift |
| commit selection | checkbox toggles commit scope only | status letter 兼任 checkbox 或触发行 click |
| narrow panel | filename/path ellipsis; meta 不换行 | checkbox/status 被挤到下一行 |
| external worktree reference | Hub follows `GitHistoryWorktreePanel` row contract | 两套 Git file list 各自发明 row layout |

### 5. Good / Base / Bad Cases

- Good：`DiffFileRow` renders status as a leading span and `InclusionToggle` as the last child inside `.diff-row-meta`。
- Good：`GitDiffPanel.test.tsx` asserts `.diff-status-letter` is the first row child and no status exists inside `.diff-row-meta`。
- Base：flat mode may show directory tail in `.diff-dir`; tree mode may hide directory tail because folder hierarchy already conveys it.
- Bad：把 `.diff-status-letter` 做成 button，既显示 `M/U/A` 又承担 commit selection。
- Bad：为了修 narrow width 给 status 加 `display: block` 或把 status 放在 file cell 前的独立 text node。

### 6. Tests Required

- `GitDiffPanel.test.tsx` MUST cover file commit selection by `getByRole("checkbox", { name: "Toggle commit selection: <path>" })`。
- Tests MUST assert the file row DOM order: status letter before icon, and no `.diff-row-meta .diff-status-letter`。
- Tests MUST cover section-level checkbox selection when `GitDiffPanelSectionActions` renders.
- Tree tests MUST cover root folder visibility when `gitRoot` is present.

### 7. Wrong vs Correct

#### Wrong

```tsx
<div className="diff-row-meta">
  <button className="diff-status-letter" aria-label={inclusionLabel}>
    {statusLetter}
  </button>
</div>
```

#### Correct

```tsx
<span className="diff-status-letter" aria-hidden>
  {statusLetter}
</span>
<span className="diff-file-icon" aria-hidden />
<div className="diff-file" title={file.path} />
<div className="diff-row-meta">
  <InclusionToggle label={inclusionLabel} state={inclusionState} stopPropagation onToggle={...} />
</div>
```

## Scenario: Topbar Consolidated Command Menus

### 1. Scope / Trigger

- Trigger：修改主窗口顶栏 action、workspace open-app 入口、右侧 panel tab overflow、或任何在 `main-topbar` / right panel toolbar 内弹出的 menu。
- 目标：小屏不平铺大量 icon，菜单视觉在 light/dark theme 与 macOS/Windows titlebar drag 语义下稳定。

### 2. Signatures

- 主入口菜单：`OpenAppMenu.extraActions?: OpenAppMenuExtraAction[]`
- 顶栏动作数据源：`useMainHeaderActionItems(options): OpenAppMenuExtraAction[]`
- 右侧面板 overflow：`ResponsiveIconToolbar({ collapseInactiveItems?: boolean })`
- 顶栏交互控件必须显式带 `data-tauri-drag-region="false"`。

### 3. Contracts

- 顶栏中间动作（runtime console / terminal / solo / browser / docs / right panel / copy path）SHOULD 合并进 workspace open-app 主入口；避免另起一个平级 overflow trigger。
- `OpenAppMenu` 的 icon-only 下拉 MUST 支持应用项和 extra action 项共用同一 command-list 视觉规格。
- 菜单视觉 MUST 使用 theme token：`var(--surface-popover)`、`var(--surface-hover)`、`var(--text-emphasis)`、`var(--text-muted)`；禁止为了 light/dark 适配写死前景色。
- 若菜单是 absolute child（例如 `OpenAppMenu`），其父容器 MUST NOT 使用会裁剪浮层的 `overflow: hidden`；需要压缩顶部布局时用 `min-width/max-width/flex` 控制，而不是裁剪 popover。
- 若菜单来自 Radix portal（例如 shared responsive toolbar），可以保留 toolbar 自身 overflow 控制，但 dropdown content 的视觉必须与主菜单保持一致。
- right panel toolbar 默认只外显 active/live/promoted item；inactive item 留在 overflow menu，防止小屏堆叠。
- macOS/Windows 顶栏中，菜单 trigger 与 menu item MUST 保持 `data-tauri-drag-region="false"`，避免 window drag 区吞掉点击。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| small viewport | 顶栏动作收进主入口或 overflow menu | icon 平铺导致堆叠/挤压 |
| light theme | 菜单背景、hover、文字对比度来自 token | 固定深色/浅色导致不可读 |
| dark theme | 图标继承 currentColor 或 theme token | 固定黑色 SVG 融进背景 |
| macOS / Windows titlebar | 点击 trigger/menu item 执行动作 | drag-region 覆盖按钮导致点了无效 |
| absolute popover | 父容器允许浮层溢出显示 | 父级 `overflow: hidden` 裁掉菜单，看起来像打不开 |
| right panel overflow | active/live 外显，其余收纳；点击 menu item 后可切换 | 所有 panel icon 默认平铺 |

### 5. Good / Base / Bad Cases

- Good：`MainHeader` 把 `useMainHeaderActionItems()` 产出的动作传给 `OpenAppMenu.extraActions`，`Copy path` 也作为同一菜单项出现。
- Good：`ResponsiveIconToolbar` 用 `collapseInactiveItems` 让右侧 panel tab 只外显生效项。
- Base：Radix menu item 与自绘 open-app menu 使用相同尺寸、圆角、hover token，视觉一致但实现可不同。
- Bad：给 `main-header-actions` 设置 `overflow: hidden` 后把 absolute menu 裁掉。
- Bad：为了省空间再新增一个平级 `...` 菜单，让用户必须猜两个入口分别装什么。

### 6. Tests Required

- `OpenAppMenu.test.tsx` MUST 覆盖 extra action 出现在同一菜单内且点击触发 handler。
- `MainHeader.topbar-session-tabs.test.tsx` MUST 覆盖 `Copy path` 写入当前 resolved workspace path。
- `PanelTabs.test.tsx` MUST 覆盖 inactive tab 收进 overflow、点击后可切换/外显。
- Topbar/session tabs 测试 MUST 覆盖 interactive controls `data-tauri-drag-region="false"`，drag lane 保持可拖拽。

### 7. Wrong vs Correct

#### Wrong

```tsx
<div className="main-header-actions" style={{ overflow: "hidden" }}>
  <OpenAppMenu iconOnly />
  <MainHeaderActions />
</div>
```

#### Correct

```tsx
const openAppExtraActions = useMainHeaderActionItems(options);

<OpenAppMenu
  iconOnly
  extraActions={[...openAppExtraActions, copyPathAction]}
/>
```

## 常见坏味道（Common Smells）

- 超长 TSX 文件里混入大量 data logic。
- 引入新组件却不加测试或行为验证。
- feature-specific 行为错误提升到 shared UI，导致耦合污染。

## Scenario: Streaming Message Visible Surface

### 1. Scope / Trigger

- Trigger：修改 live conversation message / Markdown / streaming throttle / render-safe path。
- 目标：保证 runtime delta 到达后，用户可见 assistant text 持续增长；父组件 render 不等价于真实 visible text growth。

### 2. Signatures

- `Markdown` 可暴露 `onRenderedValueChange?: (value: string) => void`，回传 throttle 后实际进入 Markdown surface 的 `renderValue`。
- `MessageRow` 可暴露 `onAssistantVisibleTextRender?: ({ itemId, visibleText }) => void`，只在 live assistant streaming path 上报。
- `StreamMitigationProfile` 可包含 `renderPlainTextWhileStreaming?: boolean`，用于临时绕过高成本 Markdown parse。
- `StreamMitigationProfile` SHOULD 允许 engine-level recovery profile（例如 `claude-markdown-stream-recovery`），用于 provider/platform 之外的 Claude long-markdown visible stall 恢复。
- `ThreadStreamLatencySnapshot` 可区分 `candidateMitigationProfile` 与 `mitigationProfile`：前者允许 UI 在 first delta 后立即使用 safe live surface，后者只能在 render lag / visible stall evidence 出现后写入。
- `MessageRow` / `MessagesRows` MAY 为 `Codex` latest assistant row 使用 staged `streamingThrottleMs`（例如 short/medium/large 三档），但 MUST 继续维持同一条 live assistant row 的 progressive reveal。
- `PresentationProfile` MUST 表达 normal baseline render cadence（例如 assistant Markdown throttle、reasoning throttle、Codex staged Markdown 开关）；provider-scoped `StreamMitigationProfile` 只能作为 evidence-triggered override。

### 3. Contracts

- live assistant text 的诊断必须基于实际可见文本长度或 rendered value，而不是 `items/renderedItems` 数组变化。
- visible text growth 必须按 `itemId` 隔离；不得用全局 last length 比较不同 assistant message item。
- visible text length 进入 diagnostics 前必须 sanitize 成有限非负整数，避免 `NaN` / `Infinity` 污染 snapshot。
- engine/platform mitigation 必须有明确 guard，例如 `activeEngine === "claude" && platform === "windows"`；不得因 provider/model 未匹配而阻塞 engine-level 修复。
- 当新证据已经证明问题属于 Claude engine-level 而非单一平台时，visible-stall recovery MUST NOT 继续被写死为 Windows-only。
- first delta 只能 prime candidate profile，不得直接记录 `stream-latency/mitigation-activated`；激活诊断必须来自 evidence-based path。
- plain-text live surface 只允许用于 streaming 中间态；turn 完成后必须回到完整 Markdown 渲染，保持 final output 语义。
- `Codex` realtime assistant snapshot SHOULD 优先使用 staged Markdown throttle，而不是默认退回 plain-text live surface；只有已有 mitigation profile 显式要求时才可强制 plain-text。
- realtime 末段的 Markdown throttle / staged rendering MUST 在 turn 完成时收敛到同一条 final Markdown 语义；不得依赖 history reconcile 才恢复结构。
- `Claude` / `Gemini` normal Markdown 与 reasoning pacing MUST come from baseline `PresentationProfile` first; mitigation activation MUST require render lag / visible stall evidence and MUST NOT be inferred from baseline profile selection alone.
- 当用户正在 composer 中输入时，live message render MAY 进一步 defer 或降频，但 MUST 保持可见 assistant text 单调增长，且 final output 语义不变。
- rollback flag 只能关闭 active mitigation，不应关闭 diagnostics 记录。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| first delta 后继续收到 delta | visible text length 持续增长或触发 visible-stall diagnostics | 只更新 spinner，正文停在首几个字 |
| Windows native Claude | 可启用 engine-level profile，无需 Qwen/provider fingerprint | 把 provider/model 当根因 gate |
| macOS Claude / non-Claude | 保持 baseline render path | 泄漏 Windows Claude mitigation |
| Codex large streaming | 允许 staged Markdown throttle，结构可渐进出现 | streaming 中默认整段退回 plain text，直到 completion 才恢复结构 |
| Claude/Gemini baseline profile | 使用 baseline throttle，保持 row cardinality 不变 | 把正常 profile 激活记录成 mitigation |
| Codex streaming + active typing | composer 输入仍可操作，幕布更新可适度 defer | 输入框与幕布同步卡死，必须等尾段 render 完成才能继续输入 |
| rollback flag 开启 | active profile 不进入 UI，diagnostics 仍记录 | 直接吞掉 evidence |

### 5. Good / Base / Bad Cases

- Good：live Markdown 通过 `onRenderedValueChange` 上报 throttle 后真实值；当 Claude Windows candidate 或 Claude engine-level visible stall recovery 命中时，用 plain text live surface 维持 progressive reveal，final message 再回 Markdown。
- Base：`Codex` large streaming 使用分档 `streamingThrottleMs`，既保住结构渐进出现，也避免每个 snapshot 都触发高成本 Markdown parse。
- Bad：为了追求顺滑，把 `Codex` realtime 一律降成 plain text，再在 completion 或 history reconcile 时突然恢复完整 Markdown。
- Bad：只在父组件 `useEffect([renderedItems])` 里记录 visible render，然后断言用户看到了最新文本。

### 6. Tests Required

- diagnostics：覆盖 `visible-output-stall-after-first-delta`，断言不依赖 provider/model。
- render：覆盖 profile 传到 `Messages -> MessagesTimeline -> MessageRow -> Markdown/plain-text surface`。
- render：覆盖 `Codex` short / medium / large streaming throttle 分档与 latest assistant live row 行为。
- interaction：覆盖用户输入活跃时，streaming row 允许 deferred render 但不丢失 final Markdown 结构。
- boundary：覆盖 non-Claude 与 macOS Claude 不激活 Windows profile。
- rollback：覆盖 disabled flag 下 diagnostics 保留、active mitigation 被 resolver 抑制。

### 7. Wrong vs Correct

#### Wrong

```tsx
useEffect(() => {
  noteThreadVisibleRender(threadId, { visibleItemCount: renderedItems.length });
}, [renderedItems, threadId]);
```

#### Correct

```tsx
<Markdown
  value={displayText}
  streamingThrottleMs={streamingThrottleMs}
  onRenderedValueChange={(visibleText) => {
    noteThreadVisibleTextRendered(threadId, {
      itemId,
      visibleTextLength: visibleText.length,
    });
  }}
/>
```

## Scenario: Shared User Input Question Card

### 1. Scope / Trigger

- Trigger：修改 `AskUserQuestionDialog`、`RequestUserInputMessage`、`UserInputQuestionCard`、`MessagesTimeline` 中的用户提问卡片渲染、宽度、tab、关闭或提交行为。
- 目标：Claude `AskUserQuestion` 与 Codex `RequestUserInput` 使用同一交互语义，避免引擎分叉导致卡片 stuck、过窄、提前提交或时间线定位漂移。

### 2. Signatures

- `UserInputQuestionCard` MUST own visual/card interaction contract:
  - `questions: RequestUserInputRequest["params"]["questions"]`
  - `activeQuestionIndex: number`
  - `onQuestionTabChange(nextQuestionIndex: number): void`
  - `onOptionToggle(questionId: string, optionValue: string, multiSelect: boolean): void`
  - `onDismiss(): void`
  - `onSubmit(): void`
- `RequestUserInputMessage` MUST own queue/draft/timeout/submission state.
- `AskUserQuestionDialog` MUST own modal/composer-overlay state and final response handoff.

### 3. Contracts

- `questions.length > 1` MUST automatically enter step mode even if the caller does not explicitly pass `showStepActions`.
- In step mode, non-final active tab primary action MUST be `Next` and MUST NOT call submit.
- In step mode, final active tab primary action MUST be `Submit` and MUST submit all collected answers through the standard response contract.
- Only one question body MAY be visible at a time; tabs and active body MUST be synchronized through `activeQuestionIndex`.
- Live question cards MUST NOT reuse normal message `.bubble` width rules; use a dedicated card class such as `request-user-input-live-card`.
- Ordinary chat bubble CSS MUST NOT be changed to fix question-card width.
- Pending cards MUST expose explicit close/dismiss affordance and local dismissal MUST hide stale cards even when runtime-side dismiss has already settled.
- Timeline rendering SHOULD anchor live request cards near their originating `item_id`; fallback tail rendering is allowed only when no anchor is available.

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| 多问题第一个 tab | 主按钮显示 `Next`，点击进入下一个 tab | 直接显示 `Submit` 并提交 |
| 多问题最后一个 tab | 主按钮显示 `Submit`，提交全部答案 | 只提交当前 tab 或继续显示 `Next` |
| 普通聊天气泡 | 保持原 `.bubble` 宽度语义 | 为放大问答卡片修改 `.bubble` 全局规则 |
| stale/timeout card | 用户可关闭，本地隐藏 | 卡片一直吸底且无法关闭 |
| anchored request | 卡片出现在对应 timeline 位置附近 | 永久固定在 composer 上方 |

### 5. Good / Base / Bad Cases

- Good：`RequestUserInputMessage` 使用 `<UserInputQuestionCard className="request-user-input-live-card" />`，自身处理 request state，卡片只处理 UI。
- Base：`AskUserQuestionDialog` 继续控制 overlay 模式，但 body/options/actions 走同一个 shared card。
- Bad：在 `RequestUserInputMessage` 里复制一套与 `AskUserQuestionDialog` 相似的 tab/action JSX。
- Bad：给 live request card 加 `className="bubble"` 后再用更高优先级 CSS 覆盖 `.bubble`。

### 6. Tests Required

- `RequestUserInputMessage.test.tsx` MUST 覆盖多问题 tab 仅显示一个 body、非最终 tab `Next` 不提交、最终 tab `Submit` 提交全部 answers。
- `AskUserQuestionDialog.test.tsx` MUST 覆盖多问题 `Next` / `Submit` 行为不回归。
- `chatCanvasSmoke.test.tsx` SHOULD 覆盖 request card timeline anchor 与 dismiss 不污染后续消息顺序。

### 7. Wrong vs Correct

#### Wrong

```tsx
<UserInputQuestionCard className="bubble" />
```

#### Correct

```tsx
<UserInputQuestionCard className="request-user-input-live-card" />
```

## Scenario: Status Panel Checkpoint Advisory Projection

### 1. Scope / Trigger

- Trigger：修改 `CheckpointPanel`、`StatusPanel` checkpoint view-model、`src/features/status-panel/utils/policies/**`、`src/features/governance/evidence/**` 或 checkpoint audit UI。
- 目标：governance evidence 默认作为 advisory 信号进入 checkpoint，稳定展示 Summary / Advisory Signals / Evidence Trail / Policy Audit / Suggested Actions，不新增 blocking gate。

### 2. Signatures

- `PolicyDecision.enforcement: "blocking" | "advisory" | "informational"`
- Bridge-fed `PolicyDecision` SHOULD carry provenance fields when available:
  - `evidenceSnapshotId?: string`
  - `evidenceObservedAt?: string`
  - `evidenceArtifactPath?: string`
  - `evidenceArtifactHash?: string`
  - `evidenceQualifier?: string`
  - `degradationReason?: string`
  - `staleAt?: string`
- `buildCheckpointSectionProjection(input)` MUST return:
  - `summary`
  - `advisorySignals`
  - `evidenceTrail`
  - `policyAudit`
  - `suggestedActions`

### 3. Contracts

- Optional governance policies MUST NOT return `verdictContribution: "blocked"`; bridge-fed contributions must type-exclude `blocked`.
- Existing core runtime/fatal failures MAY remain blocking and MUST NOT be softened by advisory governance.
- Same-source governance evidence MUST select the most severe advisory contribution; a fresh `pass` row must not hide a same-source `warn`/`fail`/stale/degraded row.
- Evidence Trail MUST preserve source id plus available provenance: observed time, artifact path/hash, qualifier, degraded reason, and stale time.
- Suggested actions are guidance only: rendering them MUST NOT execute commands, mutate files, or change checkpoint verdict.
- Suggested Actions MUST render primary user actions separately from optional command chips; long commands must truncate inside their own group and must not squeeze heading/hint copy into vertical text.
- Compact checkpoint hosts MAY hide full audit rows, but MUST preserve advisory presence through count/source summary and an expansion path.

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| stale/missing/malformed governance artifact | 显示 advisory signal + evidence trail provenance | 升级为 `blocked` |
| same source has pass and warn evidence | 选择 warn/fail/stale/degraded 作为 policy decision | 只取第一条 evidence |
| compact popover has advisory evidence | 显示 advisory summary/source + dock expansion | 隐藏后让用户误以为治理证据干净 |
| suggested validation command rendered | 可复制/查看命令，但保持 optional | render 时自动执行命令或修改 verdict |
| suggested action panel contains long commands | 主动作与 optional command group 分层展示，文案横排可换行，命令 chip 截断 | 把 hint、主按钮、长命令塞进同一横行导致中文竖排或撑宽面板 |
| core fatal/runtime failure | 保持 blocking 语义 | 被 advisory-only 规则降级 |

### 5. Good / Base / Bad Cases

- Good：`bridgeGovernancePolicies` 使用 `Exclude<PolicyVerdictContribution, "blocked">`，并把 provenance 映射到 `PolicyDecision`，`CheckpointPanel` 只渲染与复制建议命令。
- Base：compact view 只显示 advisory count 与 source summary，完整 audit 留给 dock。
- Bad：UI 文案改成 warning，但 policy decision 仍可能贡献 `blocked`。
- Bad：Evidence Trail 只显示 snapshot id，不显示 artifact path/hash/observedAt，导致 advisory 缺口不可追溯。

### 6. Tests Required

- Policy tests MUST cover warn, fail, unknown, stale, malformed, platform-qualified, and same-source mixed evidence without `blocked`.
- Projection tests MUST assert advisory signals, evidence trail provenance, and suggested action command mapping.
- StatusPanel tests MUST cover dock full sections and compact advisory summary parity.
- Conformance scripts MUST fail if bridge-fed governance policies can contribute `blocked` or omit structured enforcement/provenance fields.

### 7. Wrong vs Correct

#### Wrong

```typescript
const sourceEvidence = snapshot.evidence.find((entry) => entry.source === source);
return {
  verdictContribution: sourceEvidence?.status === "fail" ? "blocked" : "ready",
};
```

#### Correct

```typescript
type AdvisoryBridgeContribution = Exclude<PolicyVerdictContribution, "blocked">;

const sourceEvidence = selectMostSevereAdvisoryEvidence(snapshot, source);
return {
  verdictContribution: contributionForEvidence(sourceEvidence),
  enforcement: "advisory",
  evidenceObservedAt: sourceEvidence.provenance?.observedAt,
  evidenceArtifactPath: sourceEvidence.provenance?.artifactPath,
};
```

## Scenario: StatusPanel Evidence / Cost Dense Typography

### 1. Scope / Trigger

- Trigger：修改 `GovernanceEvidenceSection`、`CostBudgetSection`、`src/styles/status-panel.css` 中 `sp-governance-evidence` / `sp-cost-budget` 相关 selector，或调整 checkpoint typography 变量。
- 目标：`治理证据` 与 `成本 / Budget` 是 dense operational evidence surface，必须保持低视觉噪音，避免被 checkpoint 通用字号回归带大。

### 2. Contracts

- `.sp-governance-evidence` MUST own local typography vars: `--sp-governance-label-size`、`--sp-governance-copy-size`、`--sp-governance-meta-size`。
- `.sp-cost-budget` MUST own local typography vars: `--sp-cost-budget-label-size`、`--sp-cost-budget-copy-size`、`--sp-cost-budget-meta-size`。
- Evidence / cost section MAY override `--sp-checkpoint-label-size` and `--sp-checkpoint-copy-size` only inside its own scoped root.
- Global `.sp-checkpoint-*` typography MUST NOT be enlarged to fix or restyle evidence/cost rows.
- Evidence title, summary, source/action chips, cost badges, token breakdown labels, budget bar, and degradation guides MUST remain compact, use one coherent local font-size scale inside the same section, and wrap horizontally; they must not become hero-scale or dominate the dock.

### 3. Validation

- CSS review MUST confirm the dense section overrides remain scoped to `.sp-governance-evidence` / `.sp-cost-budget`.
- Visual QA SHOULD check that evidence rows and cost badges remain smaller than the main checkpoint headline and do not crowd the dock.

## Scenario: Composer Control Surface Geometry And Toolbar Contract

### 1. Scope / Trigger

- Trigger：修改 `src/features/composer/components/ChatInputBox/**`、`ComposerReadinessBar`、`ModelSelect`、`ModeSelect`、`ButtonArea`、`ContextBar`、`src/features/composer/components/ChatInputBox/styles/**` 或 `src/styles/home-chat.css` 中 Composer 控制面相关 selector。
- 目标：Composer 顶部负责 send target，底部负责 compact tools + send；避免模型入口重复、工具按钮回到圆形/胶囊背景、dark/light theme icon 不可见、home 与普通 composer 视觉 contract 漂移。

### 2. Signatures

- `ModelSelect` MAY receive `triggerVariant: "readiness"` and `modelGroups?: ProviderModelGroup[]` to render the readiness target trigger and provider-grouped compact list.
- `ButtonArea` SHOULD receive already-built toolbar surfaces (`toolSurface`、`panelToggleSurface`、`mainSurface`) and place secondary controls inside `.button-area-inline-tools` when expanded.
- selected skill / command / agent context chips MUST be rendered by `ChatInputBox` above `.input-editable-wrapper` inside a dedicated context row; `ButtonArea` MUST NOT receive or render selected chip surfaces.
- `ContextBar` MAY receive `showUsage?: boolean`; when embedded as tool surface, duplicate usage can be hidden while the main usage indicator remains available.
- `modelOptions` or equivalent pure helper SHOULD own provider model merging, selected fallback, custom models, and provider availability fallback.

### 3. Contracts

- Top readiness target MUST be the composer model-selection surface when model selection is available; bottom toolbar MUST NOT render a duplicate model selector.
- Model selector options SHOULD be provider-grouped and compact: one visible row per model, no long descriptions in the primary list.
- Gemini availability (`providerAvailability.gemini === true` or equivalent) MUST produce a Gemini group even before runtime model hydration returns a non-empty list.
- `.button-area-inline-tools` MUST be the scoped owner for compact tool chrome. New secondary composer controls SHOULD enter this strip instead of staying as trailing right-side buttons.
- selected context chips MUST NOT enter `.button-area-inline-tools`; they belong to the input context row above the editor.
- Inline tools MUST be icon-only in collapsed toolbar chrome. Selected mode/reasoning states MUST show icon, not text replacement.
- Inline tool hit area SHOULD remain approximately `28px x 32px`, gap `1px-2px`, icon size around `17px`, background/border/shadow transparent by default.
- Boolean or armed inline tools such as completion email, live follow, live collapse, and memory reference MUST share one selected affordance: icon remains visible, compact check overlays the icon, and icon/check color comes from one shared theme-safe selected color token.
- Home composer overrides MUST include `.home-chat-composer-host .button-area-inline-tools ...` rules for selector buttons, context tool buttons, and memory reference buttons; otherwise higher-priority homepage selector rules can reintroduce pill backgrounds.
- Toolbar icons MUST inherit `currentColor` or theme tokens. Do not use fixed-color SVG assets such as `stroke="black"` for toolbar icons.
- Composer geometry is a visual contract: normal composer radius around `14px`, home desktop radius around `16px`, home narrow radius around `14px`; readiness mode chip should be small rounded rectangle, not `999px` pill.
- Default composer body height SHOULD stay compact; home default wrapper height should remain about two rows shorter than the old `138px` treatment unless a new explicit design updates the contract.
- `ProductEngineModelSelect` used by an existing Native Session MUST treat engine selection as panel-local draft state. Engine click MUST NOT publish `onExecutionTargetChange`; only an explicit compatible model click MAY publish one complete `engine + modelCatalogEntryId + runtime model + managed provider` target and close the panel. This prevents Provider Continuation from freezing the source engine's still-compatible model before the user chooses the destination model.

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| readiness target clicked | 打开统一模型选择器，选择结果进入 send target | 顶部展示一个模型、底部另有另一个模型选择器 |
| Gemini detected | selector 中出现 Gemini group | 只因 models 数组暂为空就隐藏 Gemini |
| inline strip expanded | 工具保持 icon-only、紧凑、同排 | 部分工具留在右侧，导致间距和对齐漂移 |
| selected context chips present | skill / command / agent chip 在 editor 上方独立 context row 展示 | chip 回到底部 toolbar 并挤压工具按钮 |
| dark theme | 所有 toolbar icon 可见 | 固定黑色 SVG 融进背景 |
| light theme / home composer | inline tools 不恢复大 pill/circle 背景 | 被 `.home-chat-composer-host .selector-button` 覆盖成 34px 胶囊 |
| selected mode/reasoning | 仍显示语义 icon | 用文本替代 icon 或撑宽按钮 |
| selected boolean tools | 邮件、运行跟随、折叠步骤、记忆引用使用同色 icon + 同规格 overlay check | 混用蓝色邮件、绿色圆点、发光 badge 或容器边框 |
| default composer render | 高度紧凑，resize/max-height 可用 | 默认高度回到过高三行+大空白 |
| Native Session 从 Kimi+豆包切到 Codex+Sol | 点 Codex 只换 draft model list；点 Sol 后一次发布 Codex+Sol target | engine click 先发布 Codex+豆包并启动 Continuation，之后 UI 显示 Sol 但 runtime 回落 CLI default |

### 5. Good / Base / Bad Cases

- Good：`ComposerReadinessBar` 将 `ModelSelect triggerVariant="readiness"` 放在 provider/model target 中，`ButtonArea` 只渲染 tool toggle、inline tools、send/stop。
- Good：`ChatInputBox` 在 `.input-editable-wrapper` 上方渲染 `.chat-input-context-surface`，selected context chips 不经过 `ButtonArea`。
- Good：`ModeSelect` 使用 `codicon ${mode.icon}` 并让 CSS 通过 `currentColor` 控制 dark/light theme。
- Good：`ContextBar` / `ButtonArea` 使用 `--composer-tool-selected-color` 统一 selected/armed inline tool 的 icon 和 overlay check 颜色。
- Base：`ContextBar surface="tool-popover" showUsage={false}` 嵌入 inline tools，主 usage 由 `mainSurface` 保留。
- Bad：新增工具时直接放到 `.button-area-right`，绕过 inline strip。
- Bad：把 selected skill / command / agent chips 作为 `contextSurface` 重新传回 `ButtonArea`。
- Bad：为了让 light theme 更明显，给 inline tool 加固定黑色 SVG 或局部 `color: #000`。
- Bad：为了强调某个 active 状态，给单个 inline tool 重新加圆点、发光 badge、边框或底色，导致 selected 语言分裂。
- Bad：只改普通 ChatInputBox CSS，忘记 `home-chat.css` 的更高优先级 override。

### 6. Tests Required

- `ButtonArea.test.tsx` MUST cover inline tool visual order and absence of duplicate bottom model selector when readiness target owns model selection.
- Composer / ChatInputBox review MUST confirm selected skill / command / agent chips render above the editor and are absent from `ButtonArea`.
- `modelOptions.test.ts` MUST cover provider groups, selected fallback, custom model merge, and Gemini availability fallback.
- `ModelSelect.test.tsx` MUST cover readiness trigger and compact grouped option rendering.
- `ModeSelect.test.tsx` MUST cover codicon trigger rendering and mode selection behavior.
- `HomeChat.styles.test.ts` SHOULD assert home composer scoped override keeps inline tools transparent/compact when homepage selector rules exist.
- Theme visual QA SHOULD check dark and light composer screenshots for icon visibility.
- `ProductEngineModelSelect.test.tsx` MUST cover cross-engine two-step selection: engine click emits zero target changes; subsequent model click emits exactly one target with the selected destination engine/runtime model and `doge-token-matrix`.

### 7. Wrong vs Correct

#### Wrong

```tsx
<div className="button-area-model-slot">
  <ModelSelect value={selectedModel} onChange={onModelSelect} />
</div>
<button className="selector-button selector-button-mode-trigger">
  <img src={zidongmoshiIcon} />
</button>
```

#### Correct

```tsx
<ModelSelect
  triggerVariant="readiness"
  value={selectedModel}
  modelGroups={providerModelGroups}
  onProviderModelChange={onProviderModelSelect}
/>

<button className="selector-button selector-button-mode-trigger">
  <span className={`codicon ${currentMode.icon} selector-button-mode-icon`} />
</button>
```

## Scenario: Provider and LLM brand icons use one theme strategy owner

### 1. Scope / Trigger

- Trigger：新增/替换 provider、LLM、model icon，或在 Composer、Account、Settings 等 surface 渲染 `resolveProviderBrandIcon()` 的结果。

### 2. Signatures

- Registry：`providerBrandIconThemeStrategy(src) -> "original" | "mono-adaptive" | "dark-tile"`。
- Renderer：`<ProviderBrandIconImg src={src} className? />`。
- Global classes：`.vendor-brand-icon-img`、`.vendor-brand-icon-img--mono-adaptive`、`.vendor-brand-icon-tile`。

### 3. Contracts

- 所有 provider/model brand asset MUST 经 `ProviderBrandIconImg` 渲染；consumer 不得直接 `<img src={resolvedBrandSrc}>`。
- `currentColor` mono SVG 通过 `<img>` 加载时不会继承 DOM `color`，registry MUST 标记 `mono-adaptive`；light 为黑，dark/dim/system-dark 用 global class 反白。
- 彩色品牌使用 `original`，禁止全局 invert；白色主体品牌使用 `dark-tile`，不得在浅色 surface 隐形。
- Renderer MUST 保留 intrinsic + inline `16×16`、`max-width/max-height:100%` 与 `object-fit:contain`，避免 raster 原尺寸突破 wrapper。
- 若未来确需 light/dark 两套 asset，variant 选择仍归 registry/renderer owner；consumer 只传 brand identity 或 resolved entry，不自行判断 theme。

### 4. Validation & Error Matrix

| asset 类型 / theme | 必须行为 | 禁止行为 |
|---|---|---|
| OpenAI mono + light | 黑色 glyph | 固定白色 |
| OpenAI mono + dark/dim | 浅色 glyph | 黑色融入背景 |
| system theme + OS dark | 与 explicit dark 同口径 | 只覆盖 `[data-theme=dark]` |
| Doubao/Claude color | 保持原色 | `invert(1)` 破坏品牌色 |
| Kimi 白字 + light | dark tile 内可读 | 只剩彩色点 |
| 1024px raster | wrapper 内 16×16 contain | CSS 未加载时铺满页面 |

### 5. Good / Base / Bad Cases

- Good：Account model table 与 Composer selector 都调用 `ProviderBrandIconImg`，OpenAI 在 dark theme 自动反白。
- Base：新增 mono provider 时只扩 registry 的 mono set，所有 surface 同时生效。
- Bad：Account 单独写 `.openai-icon { filter: invert(1) }`，Settings/Composer 仍不可读。

### 6. Tests Required

- Registry test MUST 覆盖 mono/color/dark-tile 三类 strategy。
- Renderer test MUST 锁定 global classes 与 intrinsic/inline bounds。
- Static visual contract MUST 覆盖 explicit dark、dim 与 system-dark selector；至少一个 consumer contract MUST 证明不再裸渲染 resolved `<img>`。
- Affected Composer/Account/Provider component focused tests、target ESLint、typecheck MUST PASS。

### 7. Wrong vs Correct

#### Wrong

```tsx
<img src={resolveProviderBrandIcon({ modelId }) ?? ""} />
```

#### Correct

```tsx
const src = resolveProviderBrandIcon({ modelId });
return src ? <ProviderBrandIconImg src={src} /> : <BrandFallbackIcon />;
```
