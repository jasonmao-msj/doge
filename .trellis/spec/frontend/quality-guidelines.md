# Quality Guidelines（质量规范）

## Hard Rules（红线）

- 不猜接口（No guessed interface）。
- 不吞异常（No silent catch）。
- 不留死代码（No dead code）。
- 不在同一 PR 夹带无关行为变更。
- 高风险文件冲突禁止整文件覆盖 `--ours/--theirs`。

## Forbidden Patterns

- 在 feature 里直接 `invoke()`，绕过 `services/tauri.ts`。
- 交互界面硬编码文本，绕过 i18n。
- renderer 生产代码调用 native `alert()` / `window.alert()`；错误反馈必须使用 application-owned Error Toast 或 domain dialog。
- 复制粘贴相似逻辑，不做 reuse 评估。
- 修改大样式文件不跑 large-file 检查。
- 在核心流程里随意引入 `any`。
- 禁止直接 `JSON.parse()` raw model output，例如 `response.text`、AI helper result、assistant final text；必须先走 shared structured-output normalization。

## Required Patterns

- boundary 数据先 normalize 再使用。
- 模型结构化输出必须先 normalize、再由 domain validator 缩窄类型，repair 失败必须 fail closed 且不得写入 partial trusted data。
- side effect 必须 cleanup。
- `useEffect` 中清理/归一化 `Set`、`Map`、array state 时，内容未变化必须返回原 state 引用；禁止每轮返回等价的新 collection，避免 render loop。
- 错误信息要可追踪、可读、可反馈。
- 关键行为变更必须补 tests 或 contract check。
- 图标按钮 tooltip 激活后必须能关闭，禁止留下悬浮残影。
- 动态创建 Tauri `WebviewWindow` 时，window label pattern 必须同步覆盖 `src-tauri/capabilities/*.json`，并用 contract test 锁定；DOM `data-tauri-drag-region` 只解决命中区域，不会自动授予动态窗口权限。

## Scenario: Interactive Feedback Must Be Behavior-Tested

### 1. Scope / Trigger

- Trigger：新增或修改 tooltip、retry、refresh、submit、expand/collapse 等可操作 UI。
- 目标：测试必须证明用户完成了动作并看到了反馈，不能只证明 DOM 中存在按钮或 copy。

### 2. Signatures

- Async action state：至少能区分 `idle | pending | settled`；具体名称可按 domain 收敛。
- Tooltip trigger：semantic `<button type="button" aria-label="...">` + shared `Tooltip` / `TooltipContent`。
- Retry handler：返回可 await 的 `Promise<void>`，并在 in-flight 期间拒绝重复触发。

### 3. Contracts

- Tooltip MUST 通过 pointer hover 与 keyboard focus 可达；测试 MUST 激活 trigger 并断言 portal 内的实际说明内容，`getByRole("button")` 只算结构检查。
- Retry / refresh MUST 在请求期间显示 pending feedback，并在快速失败后留下可见的 settled feedback；禁止依赖可能被 React batching 合并掉的瞬时 loading frame。
- 测试 async feedback 时 MUST 使用 deferred Promise 锁住 pending phase，分别断言 pending 与 settled；禁止只断言 gateway mock 被调用。
- Icon help trigger MUST 保持独立 icon-button 样式；父状态容器不得用 `.state button` 一类 broad selector 覆盖其尺寸、border 或 background。
- App manual QA MUST 核对正在运行的 bundle identifier / product flavor，避免把旧安装包当成当前 source 或新 bundle 验收。

### 4. Validation Matrix

| 场景 | 必须断言 | 禁止的替代证明 |
|---|---|---|
| pointer hover help | visible tooltip popup + expected copy | trigger 存在 |
| keyboard focus help | visible tooltip popup + expected copy | 只有 `aria-label` |
| async retry pending | disabled / `aria-busy` + pending label | gateway spy called |
| async retry settled failure | retryable settled label / state | 页面仍长得一样 |
| packaged App QA | 当前 flavor 的新布局与真实交互 | 旧 bundle 的 screenshot |

### 5. Good/Base/Bad Cases

- Good：deferred gateway 让测试稳定停在 pending，随后 resolve 并断言 `再次重试`；pointer 与 focus 都打开 shared tooltip。
- Base：请求立即失败时，settled label 仍发生可见变化，用户知道点击已生效。
- Bad：测试只写 `expect(button).toBeTruthy()`；实现只在同一 batched turn 内 `setLoading(true)` / `setLoading(false)`；父容器 selector 同时命中 retry 与 help button。

### 6. Tests Required

- Component test：pointer hover、keyboard focus、pending、settled 四个行为断言。
- Visual contract：锁定紧凑布局关键 selector，并证明 help trigger 不落入 broad action-button selector。
- 至少一次 exact packaged App manual QA：记录 flavor/path，并实际触发 tooltip 与 retry。

## Scenario: Renderer Error Feedback Must Not Use Native Alert

### 1. Scope / Trigger

- Trigger：新增或修改 `src/**/*.ts(x)` 中的用户错误反馈。
- 目标：错误反馈保持 application-owned、non-blocking、localizable 与 testable。

### 2. Signatures

- 普通错误：`pushErrorToast({ title, message, ...options }): void`
- 需要用户决策：复用现有 domain Dialog / Confirm contract。
- 禁止接口：`alert(message)`、`window.alert(message)`。

### 3. Contracts

- renderer production code MUST NOT 调用 native `alert()` / `window.alert()`。
- 非阻塞错误 MUST 使用 existing global Error Toast；需要确认/取消语义时 MUST 使用 application-owned Dialog。
- user-facing title/copy MUST 走 i18n；raw backend diagnostic MAY 进入已有 Debug/logging channel，但 MUST 遵守 secret redaction。
- test-only negative assertions 与 security fixture strings MAY 保留 `alert` 文本，但不得在生产路径执行。
- ESLint MUST 通过 `no-restricted-globals` 与 `no-restricted-properties` 阻止新增 native Alert。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| 普通 action 失败 | global Error Toast | native Alert 阻塞 renderer |
| 需要用户确认 | domain Dialog / Confirm | 用 Alert 模拟确认 |
| backend 返回 raw parser error | 映射为本地化 copy，诊断进入 Debug | 将 parser source excerpt 直接展示 |
| test 验证未调用 Alert | test override 可访问 mock | production override 绕过 lint |

### 5. Good/Base/Bad Cases

- Good：稳定 error marker 映射 i18n copy，再调用 `pushErrorToast`。
- Base：未知错误 normalize 为 string 后进入 Toast，UI 不崩溃。
- Bad：catch 中直接 `alert(String(error))` 或 `window.alert(...)`。

### 6. Tests Required

- error path MUST 断言 `pushErrorToast` payload。
- 从 native Alert 迁移的关键链路 MUST 断言 Alert 未调用，或由 production source/lint gate 证明不存在调用。
- ESLint config 变更 MUST 执行 target lint，并用 intentional negative probe 证明禁令生效。

### 7. Wrong vs Correct

#### Wrong

```typescript
catch (error) {
  window.alert(error instanceof Error ? error.message : String(error));
}
```

#### Correct

```typescript
catch (error) {
  pushErrorToast({
    title: t("errors.requestFailed"),
    message: error instanceof Error ? error.message : String(error),
  });
}
```

## Scenario: Performance Diagnostics Must Not Amplify Renderer Jank

### 1. Scope / Trigger

- Trigger：修改 `src/services/rendererDiagnostics.ts`、`src/services/perfBaseline/frameDropMonitor.ts`、diagnostics live/export UI 或 diagnostics client-store persistence。
- 目标：观测链不能形成「掉帧 → 全量序列化/写盘 → 再掉帧 → 再写盘」反馈环，尤其不能与 cold-start 点击竞争 renderer main thread。

### 2. Signatures

- `appendRendererDiagnostic(label, payload): void`：低频 durable evidence。
- `appendVolatileRendererDiagnostic(label, payload): void`：session-only、memory-bounded evidence。
- `exportRendererDiagnostics(): RendererDiagnosticEntry[]`：合并 durable、pending、buffered、volatile snapshot。
- `MAX_PERSISTED_RENDERER_DIAGNOSTICS_BYTES = 256 * 1024`。
- `DIAGNOSTICS_PERSIST_THROTTLE_MS = 30_000`。
- severe frame durable cooldown：`60_000ms`。

### 3. Contracts

- 高频 sampler 的普通 `perf.frame-drop` MUST 写入 volatile ring，不得单独触发 `client_store_patch`。
- severe frame MAY 低频写 durable；同 cooldown 内仅允许一次。recent hotspot 若包含 `diagnostics-persist`、`diagnostics-export`、`perf-jank-live-collect` 或 diagnostics store write，MUST 保持 volatile。
- canonical durable payload MUST 同时受 category count 与 serialized UTF-8 byte budget 约束；超限时先淘汰最老 non-actionable，再淘汰最老 actionable，单个超大 entry 也不得突破 byte budget。
- 普通 durable append MUST 使用 30s leading/trailing batch；`pagehide` / hidden MAY immediate flush。
- volatile entry MUST 可从 live/export surface 读取并参与 revision，但 clear MUST 同时清除 durable、pending 与 volatile state。
- Startup diagnostics MUST 只保留一个 normal lifecycle canonical channel；禁止把 success/milestone 复制到第二个 store 后再由同一 UI 同时 live subscribe。
- 冷启 Overlay summary MUST 使用低频 pull（当前上限 1Hz）；展开 timeline MUST 冻结 user-click snapshot，收起再展开才刷新。copy MAY 在 click handler 按需读取 latest stores。
- StartupGate loading MUST 保持 manual-only；diagnostic refresh、milestone 与 timeout 均不得自动关闭。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| warn frame drop | volatile + exportable | durable write per sample |
| severe frame，非 diagnostics hotspot | cooldown 内一次 durable | 每次 severe 都写盘 |
| diagnostics-owned severe frame | volatile | 生成新的 durable frame-drop feedback |
| legacy diagnostics >256 KiB | 下一次 persist 收敛到 byte budget | 只按 entry count 截断 |
| page hidden with pending durable evidence | immediate flush | 丢失所有 pending evidence |
| clear diagnostics | durable/pending/volatile 全清 | volatile 或 legacy entry 复活 |
| cold-start normal trace burst | one canonical trace + ≤1Hz summary | trace/notice 双写 + event-cadence render |
| <1s 展开 loading logs | frozen click snapshot；reopen refresh | expanded timeline 跟随 live burst 重投影 |

### 5. Good / Base / Bad Cases

- Good：raw frame samples 留在 200-entry volatile ring，severe evidence 按 cooldown durable sampling。
- Base：低频 lifecycle/error diagnostic 继续走 `appendRendererDiagnostic`，保持 crash evidence。
- Bad：frame monitor 每次调用 durable append；diagnostics 持久化本身造成的掉帧又追加同一 store。

### 6. Tests Required

- `rendererDiagnostics.test.ts` MUST 覆盖 30s batch、volatile zero-write/export/clear、256 KiB serialized cap 与 actionable retention。
- `perfMonitoring.test.ts` MUST 覆盖 warn volatile、ordinary severe durable、cooldown、diagnostics-owned severe volatile。
- `StartupGateOverlay.test.tsx` MUST 覆盖 summary pull cadence、expanded snapshot frozen/reopen、copy latest 与 manual-only loading。
- `useGlobalRuntimeNoticeDock.test.tsx` MUST 覆盖 normal startup chatter 不镜像、abnormal evidence 保留。
- 变更后运行 focused Vitest、`npm run typecheck` 与 target ESLint；涉及 startup orchestration 时追加 `npm run check:runtime-contracts`。

### 7. Wrong vs Correct

#### Wrong

```typescript
appendRendererDiagnostic("perf.frame-drop", payload);
// 每次 rAF sample 都可能触发 diagnostics store 的全量序列化与写盘。
```

#### Correct

```typescript
if (isSevere && cooldownElapsed && !hasDiagnosticsOwnedHotspot(hotspots)) {
  appendRendererDiagnostic("perf.frame-drop", payload);
} else {
  appendVolatileRendererDiagnostic("perf.frame-drop", payload);
}
```

## Large Tree / Commit Scope 性能约束

- tree-based Git / worktree surface 的 descendant file 集合必须先在 topology helper 中预聚合，再交给 render 消费。
- folder/root row render 禁止递归扫描整棵子树重新收集 paths；需要的 `descendantPaths` 应来自 memoized/precomputed topology。
- staged/unstaged 合并后的 commit selection 状态应尽量单轮派生，避免对同一批路径多次 `filter/map/every` 叠加。
- 镜像 surface 做 parity 修复时，优先抽 feature-local pure helper，禁止在两个面板各写一套等价遍历逻辑。

## 标准验证命令

```bash
npm run lint
npm run typecheck
npm run test
```

涉及大文件或样式重构时：

```bash
npm run check:large-files
```

修改 large-file / heavy-test-noise 治理脚本时：

```bash
npm run check:large-files
npm run check:heavy-test-noise
```

Documentation-only changes may skip runtime large-file scans when explicitly noted, but any code, stylesheet, test-governance script, or CI-gate change must run the corresponding sentry.

涉及 runtime/bridge contract 时：

```bash
npm run check:runtime-contracts
npm run doctor:strict
```

## Code Review Checklist

- 变更是否对应明确需求/规范？
- payload mapping 是否前后兼容？
- async hook 是否有 race 和 cleanup 风险？
- test 是否覆盖 success/failure/edge？
- 文件落位、命名、抽象层级是否符合规范？
- 新增动态 Tauri window label 时，普通固定窗口 label 是否仍保持原语义？动态 label glob 是否进入 capability `windows`？相关权限是否有测试断言？

## Scenario: Fast Markdown Worker Stale Settlement Boundary

### 1. Scope / Trigger

- Trigger：修改 `compileFastMarkdownWithWorkerFallback`、Worker timeout/unavailable/error fallback、artifact cache 或 `shouldAcceptWorkerArtifact`。
- 目标：request scope 已失效后，任何 Worker settlement 都必须停止；不得再在 main thread 编译、sanitize、finalize 或写 cache。

### 2. Signatures

- `compileFastMarkdownWithWorkerFallback(args, options): Promise<FastMarkdownRenderResult>`
- `options.shouldAcceptWorkerArtifact?: () => boolean`
- stale diagnostic/error：`fast-markdown-worker-result-stale`

### 3. Contracts

- stale guard MUST sit between Worker/cache attempt settlement and every consumer/fallback branch。
- cache hit、Worker success、Worker unavailable、Worker reject、Worker timeout MUST all evaluate the same current-scope predicate。
- stale request MUST fail closed before `finalizeFastMarkdownArtifact`、`compileFastMarkdown`、sanitize and cache write。
- active request 的 unavailable/reject/timeout MUST preserve the existing main-thread fallback；stale protection 不能把正常降级一起关掉。
- stale drop MUST increment its diagnostic counter；不得伪装成普通 Worker failure/fallback。

### 4. Validation & Error Matrix

| Worker/cache 结果 | request active | request stale |
|---|---|---|
| trusted cache hit | return cached result | throw stale；不消费 cache |
| Worker artifact | finalize artifact | throw stale；不 finalize |
| unavailable (`null`) | main-thread fallback | throw stale；不 fallback |
| reject / timeout | record fallback + main-thread compile | throw stale；不 compile |

### 5. Good / Base / Bad Cases

- Good：统一 guard 放在“attempt 已结算、结果尚未消费”的 boundary，一处覆盖所有分支。
- Base：没有传 predicate 的调用方按 active request 处理，保持兼容。
- Bad：只在 Worker success 分支检查 stale；timeout/reject 仍会在已切换页面上占用主线程。

### 6. Tests Required

- `workerAdapterDiagnostics.test.ts` MUST cover stale cache hit、success、unavailable、reject、timeout。
- 同一测试文件 MUST retain at least one active reject/timeout fallback assertion，证明正常降级未被破坏。
- Assertions MUST prove `finalizeFastMarkdownArtifact` / main-thread compile side effects did not run for stale settlement。

### 7. Wrong vs Correct

#### Wrong

```typescript
const artifact = await precomputeFastMarkdownInWorker(args);
return artifact ? finalizeFastMarkdownArtifact(artifact) : compileFastMarkdown(args);
```

#### Correct

```typescript
const artifact = await precomputeFastMarkdownInWorker(args);
throwIfWorkerRequestIsStale(options);
return artifact ? finalizeFastMarkdownArtifact(artifact) : compileFastMarkdown(args);
```

## Scenario: Dynamic Tauri WebviewWindow label capability contract

### 1. Scope / Trigger

- Trigger：新增或修改 `new WebviewWindow(label, options)` 的 label 规则、动态窗口实例、窗口级事件/拖拽/聚焦/标题能力。
- 目标：防止固定 label 窗口可用、动态 label 窗口缺权限的回归。

### 2. Signatures

- Window label constant：`const WINDOW_LABEL = "feature-window"`
- Dynamic prefix：`const WINDOW_LABEL_PREFIX = "feature-window-"`
- Router predicate：`isFeatureWindowLabel(label: string | null | undefined): boolean`
- Capability source：`src-tauri/capabilities/*.json`

### 3. Contracts

- 固定入口若语义是复用窗口，MUST 继续使用固定 label，并保留 open-or-focus 行为。
- 多实例入口 MUST 使用动态 label prefix，并为每个实例隔离 session/cache key。
- `AppRouter` / window routing MUST 按固定 label 或 prefix predicate 识别同一窗口类型。
- Tauri capability `windows` MUST 同时包含固定 label 与动态 glob，例如 `"feature-window"` 和 `"feature-window-*"`.
- 若窗口依赖拖拽，menubar / titlebar DOM MUST 标记 `data-tauri-drag-region="true"`；交互按钮、tab、close 等内容控件 MUST 标记或保持 `data-tauri-drag-region="false"`，避免拖拽吞掉点击语义。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| fixed label open | 复用/聚焦既有窗口 | 改成每次新建导致旧入口语义漂移 |
| dynamic label open | 每次创建新实例 | 复用固定 label 或共享单一 session key |
| dynamic label capability | capability `windows` 含 `prefix-*` | 只改 router，不改 capability |
| titlebar drag | chrome 区可拖拽 | 把内容 header/tab strip 当成窗口拖拽区 |
| content buttons | 点击仍触发按钮语义 | drag-region 覆盖按钮导致点击被吞 |

### 5. Good / Base / Bad Cases

- Good：`file-explorer` 继续 open-or-focus；tab detached open 使用 `file-explorer-*`、per-window session key、router prefix predicate、capability glob、focused tests。
- Base：只有一个固定窗口入口时只使用固定 label，不引入动态 prefix。
- Bad：创建 `file-explorer-${id}` 后只更新 router，遗漏 `src-tauri/capabilities/default.json`，导致窗口渲染正常但拖拽/窗口 API 权限异常。

### 6. Tests Required

- Unit/contract test：动态 label 每次不同，且不会调用固定窗口 `getByLabel` 复用逻辑。
- Unit/contract test：capability JSON `windows` 包含 `${PREFIX}*`，并包含所需 window permission。
- Router test：固定 label 与动态 prefix label 都渲染同一窗口 view。
- Component test：menubar/title copy 带 `data-tauri-drag-region="true"`；内容按钮保持非拖拽区域。

### 7. Wrong vs Correct

#### Wrong

```typescript
const label = `file-explorer-${Date.now()}`;
new WebviewWindow(label, options);
```

#### Correct

```typescript
export const FILE_WINDOW_LABEL = "file-explorer";
export const FILE_WINDOW_LABEL_PREFIX = "file-explorer-";

export function isFileWindowLabel(label: string | null | undefined): boolean {
  const normalized = label?.trim() ?? "";
  return normalized === FILE_WINDOW_LABEL || normalized.startsWith(FILE_WINDOW_LABEL_PREFIX);
}
```

## Scenario: Claude history loader control-plane fallback filtering

### 1. Scope / Trigger

- Trigger：修改 `src/features/threads/loaders/claudeHistoryLoader.ts`、Claude history service payload、legacy/cached history restore，或 backend Claude history filtering contract。
- 目标：frontend loader 作为兜底层过滤 Codex / GUI control-plane payload，但不能代替 backend 权威过滤。

### 2. Signatures

- `parseClaudeHistoryMessages(messagesData: unknown): ConversationItem[]`
- `createClaudeHistoryLoader(...): HistoryLoader`

### 3. Contracts

- Loader MUST treat backend payload as `unknown` and narrow through local guards before filtering or rendering.
- Loader MUST skip control-plane entries before producing `ConversationItem` rows.
- Control-plane matching MUST require high-confidence structure: `method=initialize`, `params/payload.clientInfo.name/title=ccgui` with `capabilities.experimentalApi`, `developer_instructions`, or pure Codex app-server invocation text.
- Pure Codex app-server text means `app-server` alone or command-token form such as `codex app-server`, `codex.exe app-server`, `codex.cmd app-server`, or `codex.bat app-server`.
- Loader MUST preserve normal user/assistant messages that merely mention `app-server` or `codex app-server` in natural language.
- Backend remains the authoritative session list/load sanitizer; frontend filtering is only a legacy/remote/cache fallback.

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| old backend returns `initialize` payload | skip row | render pseudo user message |
| old backend returns `developer_instructions` payload | skip row | show internal instructions |
| mixed history includes real user message | keep real message | drop whole transcript |
| user text mentions `app-server` / `codex app-server` | keep message | keyword-only filtering |
| unknown malformed history payload | return safe empty/parsed subset | throw during restore |

### 5. Good / Base / Bad Cases

- Good：`parseClaudeHistoryMessages()` filters structured control-plane rows before role/kind conversion.
- Base：backend already filtered pollution; frontend predicate sees only normal messages.
- Bad：`if (text.includes("app-server")) continue;` because it drops valid user questions and debugging transcripts.

### 6. Tests Required

- Vitest: filters `initialize` / `developer_instructions` rows.
- Vitest: mixed transcript keeps real user message.
- Vitest: normal user text with `app-server` / `codex app-server` keyword is preserved, while pure command-token `codex app-server` is filtered.

### 7. Wrong vs Correct

#### Wrong

```typescript
if (asString(message.text).includes("app-server")) {
  continue;
}
```

#### Correct

```typescript
if (isClaudeControlPlaneMessage(message)) {
  continue;
}
```

## Scenario: Unit tests isolate runtime-heavy child components

### 1. Scope / Trigger

- Trigger：组件测试渲染 workspace home、app shell、summary/dashboard surface，且渲染树包含 `BrowserDock`、Tauri bridge、polling/listener、webview/session bootstrap 等 runtime-heavy child。
- 目标：防止非目标测试真实挂载 runtime-heavy child 后产生 React `act(...)` warning、stderr noise 或异步 cleanup 漂移。

### 2. Signatures

- Test file：`src/features/**/components/*.test.tsx`
- Runtime-heavy child mock：

```typescript
vi.mock("../../browser-agent/components/BrowserDock", () => ({
  BrowserDock: () => null,
}));
```

### 3. Contracts

- If the test does not assert the runtime-heavy child behavior, it MUST mock that child at module boundary.
- Summary/home tests SHOULD assert their own rendered contract only, not incidental webview/session bootstrap effects.
- Tests MUST NOT leave React `act(...)` warnings or stderr payloads for `heavy-test-noise` to collect.
- Runtime-heavy child behavior MUST be covered in its own focused test file, where async effects are explicitly awaited or mocked.
- React 19 Suspense / `React.lazy` teardown MUST drain both microtasks and host-task scheduled work inside `act(...)`; do not assume repeated `Promise.resolve()` alone covers `pingSuspendedRoot`.
- Do not solve unrelated `act(...)` warnings by globally silencing `console.error`; that hides regressions.

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| WorkspaceHome summary test | mock `BrowserDock` if browser behavior is not under test | real mount triggers BrowserDock async state updates |
| BrowserDock behavior test | test BrowserDock directly with awaited effects/mocked services | rely on WorkspaceHome tests for BrowserDock coverage |
| heavy-test-noise gate | no `act` / stderr violations | passing assertions but noisy CI failure |
| Suspense lazy boundary teardown | drain microtask + host task inside `act(...)` | only add more `Promise.resolve()` rounds |
| unrelated child warning | isolate or await the actual child effect | blanket `console.error = vi.fn()` |
| async preview/outline compile | wait for the rendered async state that proves compile settled | exit test after initial render and leak `act(...)` warning |

### 5. Good / Base / Bad Cases

- Good：`WorkspaceHome.test.tsx` mocks `BrowserDock` to keep workspace summary tests deterministic.
- Base：a parent component test mocks Tauri-dependent children that are outside the assertion scope.
- Bad：letting a dashboard test mount `BrowserDock`, polling hooks, and webview bootstrap just because they appear in the production tree.

### 6. Tests Required

- Parent tests：assert parent-owned UI and callbacks after runtime-heavy children are mocked.
- Child tests：cover the runtime-heavy component separately, including async effect settle, cleanup, and failure paths.
- Gate：when touching test-governance or noisy runtime components, run the relevant targeted test and `heavy-test-noise` gate used by CI.

### 7. Wrong vs Correct

#### Wrong

```typescript
render(<WorkspaceHome workspace={workspace} currentBranch={branch} />);
// BrowserDock mounts and emits act(...) warnings unrelated to WorkspaceHome.
```

#### Correct

```typescript
vi.mock("../../browser-agent/components/BrowserDock", () => ({
  BrowserDock: () => null,
}));

render(<WorkspaceHome workspace={workspace} currentBranch={branch} />);
```

## CodeMirror State-Coupled Extensions 不可跨越 Lazy Boundary

### Scope / 触发

本规则约束 `src/features/files/**`、任何把 CodeMirror / `@uiw/react-codemirror` / `@codemirror/*` 用作 **state-coupled extension** 的编辑面（当前唯一现实路径是 file panel，后续 Codex 桌面编辑器 / composer 内嵌 code block 同样适用）。

**state-coupled extension** 指：被注入 `extensions` prop 后会注册 `StateField` / `StateEffect`，并且其它同步 API（keymap run、命令调用、panel 状态读取）依赖该 field 同步存在的 extension。具体包含但不限于：

- `@codemirror/search` 的 `search({ top })`、`searchKeymap`、`openSearchPanel` / `closeSearchPanel` / `searchPanelOpen`
- `@codemirror/autocomplete` 的 `autocompletion({})`、`startCompletion`
- `@codemirror/lint` 的 `linter(...)` / `lintGutter`
- `@codemirror/view` 内的 `keymap.of([...])`（被多 panel 共享的 keymap）
- 任何自定义 `StateField` 配套 API

### Hard Rule / 红线

- 不得把上述 state-coupled extension 拆到 `React.lazy` / 动态 `import()` 边界**之后**。
- 不得用 `ensureXxxLoaded` 这类"首次 dynamic import，导入未完成时返回 null"的 wrapper 替换静态 `import`。
- 不得把 "Mod-F / Cmd-F 这类同步 keymap run" 改成 `async (view) => { await import(...) }`——同步 keymap 路径必须保留同步可用。
- 允许把 CodeMirror 整体（`@uiw/react-codemirror` + `@codemirror/view`）按"edit mode 激活"或"打开文件时才挂载"的粒度拆到 lazy 边界；该粒度下所有 state-coupled extension 跟 shell 一起 chunked 化是合规的。

### 理由 / Why

`@codemirror/search` 的 `search({ top })` 会在 `EditorState` 中注册 `searchState` field，并把 search query、replace state、当前 match index 全部存在该 field 上。Mod-F / Cmd-F 的同步 keymap run、toolbar 上"下一个/上一个/替换"按钮、IME 复合输入、selection-driven 搜索都是基于该 field 的 transaction。

一旦拆到 `React.lazy` 之后：

- 第一次 dynamic import 还没 resolve 时，editor view 内 `openSearchPanel` 因 `searchState` field 不存在而抛错（"state.field is not a function"）或直接 noop，连续 Cmd+F 出现"开了但跳不回原文位置"、"替换不同步"、"光标错位"等 regression。
- 即使缓存 resolve 后再 `setExtension`，React 的 Suspense + re-render 会导致 lazy chunk 内构造的 extension 引用和 shell 持有的 `extensions` prop 数组对不上，editor view dispatch 时引用 mismatch，search query 与 cursor selection 解耦。
- `replace` / `replace-all` 是 transactional effect 链，不是 panel 开关；dynamic 注入时无法维持"搜索-高亮-替换"的 contiguous navigation 语义。

### Valid Pattern

```typescript
// 静态 import 在 file panel 启动路径上是 OK 的
import { search } from "@codemirror/search";

// 在 editor 装配时同步注入
const editorExtensions = useMemo(
  () => [saveKeymapExt, editorNavigationKeymapExt, search({ top: true })],
  [],
);
```

### Invalid Pattern (Reverted 2026-06-11)

```typescript
// ❌ 不要这样：把 search 拆到 React.lazy 之后的 module
import("@codemirror/search").then(({ search }) => setExtension(search({ top: true })));
// 同步 keymap run 拿不到 commands；连续 Cmd+F 断流
```

### 验证 / 验证口径

任何"为压缩 startup bundle 而拆出 `@codemirror/*`"的 change 落地前必须：

1. 在 proposal.md 显式列明该模块是不是 state-coupled extension（对照本节列表）。
2. 若是 state-coupled，**禁止拆出**，并在 tasks.md 把对应实施项标 `- [ ] Withdrawn` 并写明理由。
3. 用真人在 Tauri 桌面里连续按 Cmd+F 验证：开启 → 输入查询 → 跳下一个 → 替换 → 替换全部，行为必须与 baseline 完全一致。
4. 跑 `npx vitest run src/features/files/components/FileViewPanel.typing-latency.test.tsx` 之外，**额外**跑 `FileViewPanel.find-in-file.test.tsx`（如不存在，新建；至少覆盖：开启 search panel、连续 Cmd+F 切换 toggle、search query 持久化、replace 单次、replace-all 多次）。

### 历史回归

- 2026-06-11 `lazy-file-preview-dependencies` change 中曾尝试将 `@codemirror/search` 拆到 `FileCodeMirrorEditor` lazy 边界后，CI / 单元测试通过，但 Tauri 桌面中 Cmd+F 出现"开了但跳不回原文位置、replace 不同步"等 regression。该 change 已撤回并把 `@codemirror/search` 留在 file panel 启动路径上。详见 `openspec/changes/lazy-file-preview-dependencies/proposal.md` 的 *Withdrawn Optimization* 章节和 `openspec/docs/lazy-state-extension-regression-2026-06-11.md`。

## Markdown Math Normalization MUST Preserve Container and Math-Range Idempotence

### Scope / Trigger

- Trigger：修改 `src/features/markdown/markdownMath.ts`、消息 Markdown math compatibility、file Markdown preview math normalization，或新增 delimiter / prose heuristic。
- 目标：多 pass normalization 不能破坏 Markdown container boundary，也不能再次改写已经建立的 math range。

### Signatures

- `normalizeMarkdownMathForMessage(value: string): string`
- `normalizeMarkdownMathForFilePreview(value: string): MarkdownMathNormalizationResult`
- Shared implementation：`normalizeCommonMathDelimiters(value: string)`

### Contracts

- Normalization MUST operate on render-time copies；不得修改 canonical message、Codex JSONL 或 persisted file source。
- Standalone `\\[` / `\\]` delimiter lines 只有在 opener / closer 具有相同 whitespace/blockquote prefix 时才可转换。
- 成功转换 MUST 只替换两条 delimiter lines；formula body 与 source line count MUST remain unchanged。
- Generic inline/fallback regex MUST NOT flatten unresolved standalone delimiters across list、blockquote 或 root containers。
- 一旦 `$...$` / `$$...$$` range 已建立，后续 plain-parentheses 或其它 inline heuristic MUST treat its body as immutable math content；禁止 nested dollar wrapping。
- Rich message 与 file preview MUST reuse the shared pure normalizer；lightweight streaming path MUST remain outside this heavy normalization chain。

### Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| ordered-list standalone display | opener/body/closer 留在同一 list container | delimiter 退回 root，跨段吞入 prose |
| blockquote/nested prefix | exact delimiter-line prefix preserved | 去掉 `>` 或 continuation indentation |
| incompatible/unmatched delimiters | candidate unchanged | generic regex 跨 container 配对 |
| display body starts with `(\\theta,...)` | parentheses 留在 display expression 内 | 转成 `$\\theta...$` 后再塞入 `$$...$$` |
| file preview normalization | normalized line count 与 `lineMap` 稳定 | 为 delimiter conversion 插入/删除 source lines |
| lightweight streaming | 保持原 lightweight path | 每个 delta 执行 full math normalization |

### Good / Base / Bad Cases

- Good：line-aware pass 原位把 `   \\[` / `   \\]` 改成 `   $$`，并在 plain-parentheses pass 前 guard established dollar math ranges。
- Base：root-level `\\[x^2\\]`、inline `\\(x_i\\)` 与既有 `$...$` 继续使用原 compatibility behavior。
- Bad：全局 `replace(/\\\\\[/, "$$")` 后重排 body，或让 `($\\theta$)` / `$$ $\\theta$ $$` 进入 `remark-math`。

### Tests Required

- Message DOM regression：断言预期 `.katex-display` 数量、`.katex-error` 为 0、后续 prose 不在 `.katex` subtree。
- Pure normalization assertion：锁定 parenthesized display body 不出现 nested single-dollar delimiters。
- File preview regression：覆盖 list、blockquote、unmatched/incompatible prefix 与 `lineMap`。
- 若问题来自真实会话，verification artifact SHOULD 记录匿名化 fixture 或 session UUID replay 结果，但 test MUST NOT 依赖用户 home directory。
## Scenario: Global Search Lazy Provider Hydration And Cross-Workspace File Navigation

### 1. Scope / Trigger

- Trigger：新增 global search provider，且 provider 数据来自 workspace disk/cache；或 search result 会打开另一个 workspace 的文件。
- 目标：未 hydrate 不得伪装成 empty，query 不得触发磁盘 IO，跨 workspace navigation 不得写入旧 workspace 的 file-tab state。

### 2. Signatures

- Search snapshot：`WorkspaceSearchApiSnapshot { endpoints, status, error }`
- Hydration status：`SearchApiHydrationStatus = "idle" | "loading" | "complete" | "error"`
- Project Map bridge：`readProjectMapRelationships({ workspaceId })` / `scanProjectMapRelationships({ workspaceId })`
- File open：`handleOpenFile(path, location?, { targetWorkspace })`
- Endpoint navigation：`SearchResult.fileLine` → `handleOpenFile(path, { line, column, scrollPosition: "center" }, ...)`

### 3. Contracts

- Palette open 且 filter 包含 provider 时，MUST 先读 cache；missing/stale 才触发 disk scan。
- Query keystroke MUST 只消费 memory snapshot，不得调用 disk bridge。
- `loading` 与 confirmed `complete + []` MUST 是不同状态；error MUST 可在下一次 palette lifecycle 重试。
- Hydration effect MUST 使用 latest ref 读取 snapshot；发布 `loading` 不得 cleanup 自己的 in-flight request。
- Workspace hydration MUST keep a hook-lifetime in-flight Promise registry；scope/filter/palette lifecycle cleanup 后，新 consumer MUST 复用同一 request 并最终收敛。
- Cross-workspace result MUST 显式传 `targetWorkspace` 给 `handleOpenFile`；只先调用 `selectWorkspace()` 不足以保证 file-tab ownership。
- API endpoint result MUST preserve a valid same-source `evidence.line`; navigation MUST center、focus and briefly flash that handler line.
- Missing/invalid endpoint line MUST degrade to file-only open，不得猜测行号。
- CodeMirror centered-scroll runtime MUST stay inside lazy `FileCodeMirrorEditorImpl`；shell hooks 只能通过 type-only handle / imperative method 调用。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| cache missing | loading → scan → read → complete/empty | 立即显示 confirmed empty |
| cache stale | 旧结果可搜 + 后台 refresh | 清空结果后等待 |
| scan error | provider error、其他结果继续、下次可重试 | silent catch 或阻断 palette |
| query 连续变化 | 复用 snapshot | 每次击键扫描磁盘 |
| 跨 workspace 文件结果 | target workspace tab state 收到文件 | 文件写入旧 active workspace |
| endpoint 有可信 evidence line | handler line 居中、聚焦、短暂 flash | 只打开文件顶部 |
| endpoint 无可信 line | 安全打开文件 | 猜测 annotation/method 行号 |
| hydration 中切 scope/filter/开关 palette | 复用 in-flight request 并收敛 | snapshot 永久 loading/refreshing |
| centered editor navigation | lazy implementation 内 dispatch | shell runtime import `@codemirror/view` |

### 5. Good / Base / Bad Cases

- Good：provider data/state 独立，active workspace 优先，global workspace bounded hydration。
- Base：可复用已有 bounded full scan；只有 metric evidence 证明必要时才抽取 shared walker 后做 provider-only scan。
- Bad：复制一套 ignore walker/parser，或把多个 provider 的 loading/error 合并成一个不可归因状态。

### 6. Tests Required

- Provider test：path、method + path、handler/operation、non-HTTP endpoint。
- Hook test：missing cache 触发一次 scan，完成后 endpoint 进入 `apiSources`。
- Component test：loading 不显示 confirmed no-results，file/API 状态可并存。
- Navigation test：`targetWorkspace` 精确传入，target workspace file-tab state 接收 path。
- Endpoint navigation test：same-source evidence line、missing-line fallback、centered location payload。
- Lifecycle test：scan pending 时关闭/重开 palette，scan count 保持 1 且 active consumer 最终 complete。
- Lazy-boundary gate：shell hook 对 `@codemirror/view` 保持 `import type`。
- Gates：`npm run typecheck`、`npm run lint`、`npm run check:runtime-contracts`、focused Vitest。

### 7. Wrong vs Correct

#### Wrong

```typescript
selectWorkspace(result.workspaceId);
handleOpenFile(result.filePath);
```

#### Correct

```typescript
selectWorkspace(result.workspaceId);
handleOpenFile(result.filePath, undefined, {
  targetWorkspace: workspacesById.get(result.workspaceId),
});
```
