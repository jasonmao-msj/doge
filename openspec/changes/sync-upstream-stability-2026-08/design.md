## Context

本 change 面对的是一次高冲突 selective sync，而不是普通 upstream merge。merge-base 之后，doge 与 upstream 都修改了 `threads/hooks`、`engine/status`、Codex runtime、Composer/model catalog、workspace files、release workflow 与 OpenSpec/Trellis；其中 doge 的修改承载账号托管、Product protocol projection、lazy engine provisioning 和独立发布链，不能被文件级冲突策略覆盖。

Explore 结果已固化在 [`upstream-capability-matrix.md`](./upstream-capability-matrix.md)。它把 476 个上游提交按 capability 聚类，并记录 `adopt / adapt / already-covered / reject / defer`、上游 SHA、doge 意图和验证面。

## Goals / Non-Goals

**Goals:**

- 复用上游已验证的根因修复，同时保留 doge 产品与数据 ownership。
- 所有冲突按 symbol/capability 做 semantic merge，留下 upstream evidence 与 doge-specific adaptation rationale。
- 先修 correctness/provider facts/cross-platform safety，再考虑需要大架构迁移的性能特性。
- 同步后的 terminal、provider、model、filesystem、Git contract 可由 focused tests 与 OpenSpec 验证。

**Non-Goals:**

- 不把 upstream ancestry 整体 merge 进 doge。
- 不导入 upstream-only engine、壁纸、品牌、账号、analytics、updater、release 或大量历史 OpenSpec artifacts。
- 不以 timeout/正文/active tab 伪造 terminal authority。
- 不在缺少威胁模型时放宽 filesystem containment。

## Decisions

### Decision 1: 用 capability matrix 决定同步，而不是用文件或提交数量决定

每个上游 commit 先映射为产品 capability，再判断 doge 是否已有更强 contract。单一职责且 clean-apply 的实现可保留原 patch；混有上游产品/文档/其它 bug 的 commit 只抽取必要 symbol。

Alternatives：merge upstream 会导入无用 surface；机械 cherry-pick 会复制错误 ownership。两者均拒绝。

### Decision 2: correctness wave 的优先级高于 architecture/performance wave

本 change apply 顺序固定为：

1. terminal text integrity；
2. bounded tool-output retention；
3. Codex provider/model/context facts；
4. Windows/macOS cross-platform guardrails；
5. Markdown local file link 与 Git discard；
6. build fail-closed；
7. audit already-covered items。

Session Index、AppShell、Incremental Markdown、client-store worker performance 进入 deferred backlog。这样可以避免为了获得一个 bug fix先接受整套未验证架构。

### Decision 3: terminal text 修复采用上游 causal drain + salvage，但不改变 terminal authority

`flushPendingRealtimeEvents()` 将同步 drain legacy queue、normalized queue 与 `NormalizedRealtimeBatcher` 的 terminal batch；`settleCompletedTurn` 在写 terminal barrier 前统一调用 flush。barrier 后只允许 non-empty assistant `completeAgentMessage` 作为 content salvage 同步合入，不允许它恢复 processing、active turn 或建立第二 terminal。

这直接采用 `0d8f2426c` 的方法，同时保留 doge `useThreadTurnEvents` exact-turn alias settlement 和 `liveAssistantTextChannel` tail drain。

Alternatives：依赖 history reload 会造成当前会话丢字；放宽所有 late events 会复燃已完成 turn。两者均拒绝。

### Decision 4: provider事实只能变得更精确，不能引入第二个 Product catalog owner

- Codex context window 未上报时保持 `None/null`。
- Codex managed provider scoped catalog 只包含 provider 声明/发现的 models，不拼 official generated fallback。
- runtime reasoning metadata 仅按 normalized runtime model 补缺；不得覆盖 provider metadata，不得把 UI catalog id 发给 CLI。
- GUI/daemon `env_key` resolution 只在 Native Rust owner 读取 environment；resolved secret 不进入 renderer、日志或 persisted business config。
- Product mode 继续由 endpoint-level `apiProtocols` → `projectProductTargetCatalogV1` 投影，legacy provider catalog 不能覆盖它。

### Decision 4a: Tool output 在 durable/presentation 边界有界，而不是只限流 dispatch

上游 `f3355b56f` 证明仅控制 flush cadence 仍会让 reducer item 随长命令单调增长。doge 在 neutral `src/utils/boundToolOutput.ts` 统一保留 command output 的 64 KiB head + recent tail（总计 ≤256 KiB），fileChange 使用 1 MiB budget；连续 append 会累计 omitted count。现有 `useToolOutputTailGate` 继续控制 dispatch cadence，新的 helper 控制 retained state，两者职责分离。

### Decision 5: native/Windows guards必须 failure-safe，不能成为启动 gate

- `build.rs` 只在 Windows 给 `doge` binary 配置 8 MiB stack reserve。
- selected deep async call chains 使用 `Box::pin`，不导入同 commit 的无关行为。
- F5 采用 Web key guard + Windows native message hook；hook 安装失败只记录诊断，App 仍启动。macOS/Linux 不调用该 native API。
- PowerShell/`where` 使用现有 `std_command` no-window helper。
- Windows `process_is_alive` 没有可靠 portable equivalent 时返回 conservative false，由上层 scoped recovery 处理，不伪造 live owner。

Native WebView gate 三问：没有完全等价的纯 Web 方案可以保证 WebView2 accelerator 不触发；failure 不锁 App、无持久化值；平台证据为 Windows 已证实、macOS/Linux 不进入代码路径。

### Decision 6: Windows path compatibility 与 filesystem security 分开处理

Markdown drive/UNC link 解析只产生 normalized local-resource reference，最终打开仍经过既有 Tauri opener/path owner。上游 `canonicalize_or_original` 不在本 change 整体采用，因为它把 canonical failure 降级扩散到 external absolute read/write/delete；该问题进入单独 threat-model change。

### Decision 7: Git discard只移植 index语义，不移植同 commit 的 UI/i18n杂项

unstaged discard 等价于从 index 恢复 working tree；staged content 必须保留。Desktop 与 daemon 调用同一 core helper，避免两份 Git semantics 漂移。

### Decision 8: upstream attribution 与 doge spec authority 分离

代码注释/PR 描述记录 upstream SHA；doge OpenSpec delta 使用 doge capability 名称和当前 contract。不上游整个 OpenSpec archive，不把 upstream product version/branding 写入 doge facts。

## Cross-Layer Contract Matrix

| Boundary | Input | Output | Failure behavior | Main tests |
|---|---|---|---|---|
| normalized realtime batcher → terminal settlement | queued events + exact turn | durable reducer content before barrier | non-content late events dropped | `useThreadItemEvents.terminalTextCommit` / wrapper tests |
| Codex usage event → frontend token view | provider usage fields | nullable context window | unknown remains unreported | Rust adapter + `useAppServerEvents.tokenUsage` |
| Provider config → Codex child env | profile config `env_key` | resolved process env only | missing variable contextual error, no disk fallback | provider env Rust tests + daemon compile |
| Provider catalog → model picker/target | scoped profile models | exact id/model/reasoning facts | empty scoped catalog remains empty/guidance | status + catalog owner tests |
| Markdown link → opener | drive/UNC/relative href | normalized safe local path | malformed link stays text / visible error | remark/resource/opener Vitest |
| Git discard → index/working tree | repo + path | working tree restored from index | staged blob unchanged; contextual error | Rust core/daemon tests |
| Windows startup/native guard | platform + main window | protected WebView / larger stack | guard failure diagnostic-only | TS guard tests + Windows compile in CI |

## Risks / Trade-offs

- [Risk] late assistant salvage could merge an unrelated future turn → Mitigation: require exact thread/turn normalized event, assistant role, non-empty complete operation; never mutate lifecycle.
- [Risk] provider env resolution leaks secrets → Mitigation: Rust-only map, redacted diagnostics, no renderer payload/persistence.
- [Risk] Codex fallback removal produces an empty picker → Mitigation: doge Product catalog remains separate; legacy managed provider shows configured-default/custom guidance rather than ghost official rows.
- [Risk] native F5 hook breaks startup → Mitigation: Windows-only best-effort install, no persisted toggle, frontend guard remains; failure never gates AppShell.
- [Risk] stack linker target name drift → Mitigation: contract test/inspection against canonical `doge` binary name and Windows CI build.
- [Risk] selective port misses hidden upstream dependency → Mitigation: import graph/search before each patch, focused compile/test after each wave, no whole-file ours/theirs.
- [Risk] scope expands into 476-commit rewrite → Mitigation: matrix explicitly defers architecture waves and rejects upstream-only products.

## Migration Plan

1. Add OpenSpec/Trellis artifacts and strict-validate apply plan.
2. Implement independent waves in the fixed order above; after each wave run nearest tests.
3. Run L3 contract/type/Rust verification and doge isolation/branding gates.
4. Record deferred candidates and verification evidence; no data migration is required.
5. Rollback is code-only: each wave is isolated by files/tests and adds no persistent schema. Provider env helper/config materialization remains compatible with existing profiles.

## Open Questions

- Windows F5 native hook requires Windows CI compile evidence; local macOS cannot prove runtime hook behavior.
- Network-drive canonicalization remains intentionally unresolved until symlink/reparse containment can be tested on Windows.
- Session Index/history-window adoption needs a separate proposal because it changes the canonical list/history owner.
