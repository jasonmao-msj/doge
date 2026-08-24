---
type: guide
status: active
---

<!-- DOC-LIFECYCLE: active-guide -->
> [!NOTE]
> **Lifecycle: Current onboarding guide.** 已按产品 `0.7.16` 校准；概念性名称不能替代真实 source symbol，接入前必须核验当前 engine registry、capability matrix 与 runtime adapters。

# 新 CLI 接入指南（Engine Onboarding Guide）

> 初始日期：2026-07-27
> 内容类型：How-to + conceptual integration contract + 全量注册点核对矩阵
> 生命周期：accepted；流程有效，注册点已按 2026-08-04 代码校准
> 最近校准：2026-08-04 · mossx `0.7.16` · HEAD `e0f8c0aa77`
> 上游契约：[`mossx-multi-cli-provider-session-foundation-design.md`](./mossx-multi-cli-provider-session-foundation-design.md)（下称**基石设计**）
> 适用读者：要为 mossx 接入新 Agent CLI（如 Auggie、未来任意 CLI）的工程师
> 核心结论：接入一个新 CLI = **一次 Capability Spike + 按 §0 核对矩阵逐层勾选 + 15 项 Contract Tests**。矩阵中标注 ⚠ 的点**不会编译报错、不会测试失败，只会静默缺功能**——历史接入事故（幕布缺 streaming 态、provider 图标错位、Shared 目标被静默改写）全部出自这组点。

---

## 零、全量接入点核对矩阵（主核对表）

接入一个新 CLI 时，把本节打印出来逐行勾选。每行包含：**文件 → 职责 → 漏掉的后果**。

图例：🔴 = 漏了会编译/测试失败（有兜底）；⚠ = **漏了不报错、静默缺功能**（接入事故高发区）；🔵 = 按需（能力相关，不需要可跳过但要写决策记录）。

### A. Identity 层（引擎身份，前后端各一份）

| # | 文件 | 职责 | 漏掉的后果 |
|---|------|------|------------|
| A1 🔴 | `src/types/engine.ts` | `EngineType` union | 全仓库 typecheck 闸门 |
| A2 🔴 | `src/features/engine/engineIds.json` | id / displayName / shortName / adapterId / protocolFamily / executionModel / capabilityProfile 的 SSOT | `check:engine-adapter-registry` 失败 |
| A3 🔴 | `src/features/engine/engineRegistry.ts` | `BUILTIN_ENGINE_REGISTRY` 包装；新协议族需扩 `EngineProtocolFamily` union | registry parity gate 失败 |
| A4 🔴 | `src-tauri/src/engine/mod.rs` | `EngineType` variant + `display_name()` / `icon()` / `engine_enabled_in_settings()` / `EngineFeatures` 等 exhaustive match + `pub mod` | 编译器会逐个列出集成点——**这是免费的接入清单，不要 `_ => unreachable!()` 糊掉** |
| A5 🔴 | `src-tauri/src/bin/cc_gui_daemon/engine_bridge.rs` | daemon 二进制的**平行** `EngineType` 枚举 + `display_name`/`icon` match + 每个 per-engine 文件的 `#[path]` include | daemon 二进制编译失败或新引擎在 daemon 模式下消失 |
| A6 🔴 | `src-tauri/src/engine/adapter_registry.rs` | `EngineAdapterRegistry::with_builtins()` 数组 + `engine_id()` match；非 stream-json 协议需在 `BuiltinEngineProtocol::family()` 加路由 | registry parity gate 失败 |

自检：`pnpm check:engine-adapter-registry`

### B. Rust Runtime 层（进程 / 状态 / 命令分发）

| # | 文件 | 职责 | 漏掉的后果 |
|---|------|------|------------|
| B1 🔴 | `src-tauri/src/engine/manager.rs` | session 集合字段（每引擎一个 manager/registry）+ `refresh_engine_status*` detect match + per-engine config accessor | 编译错误 |
| B2 🔴 | `src-tauri/src/engine/status.rs` | `detect_<engine>_status` + `resolve_engine_type()` 字符串分支 + `get_engine_models` 分发 + 模型目录读取 | 编译错误或新引擎永远检测不到 |
| B3 🔴 | `src-tauri/src/engine/commands.rs` | `engine_send_message` / `engine_send_message_sync` / `engine_interrupt` / `get_engine_models` 四个 dispatch match | 编译错误 |
| B4 🔴 | `src-tauri/src/engine/events.rs` | 事件 envelope 的 engine→字符串 match | 编译错误 |
| B5 ⚠ | `src-tauri/src/command_registry.rs` | per-engine `list_/load_/delete_<engine>_sessions` 等命令注册 + `engine/mod.rs` re-export | 前端调命令得到 "unknown command"；Session 管理页对该引擎空白 |
| B6 🔴 | `src-tauri/src/workspaces/commands.rs` | `add_workspace` per-engine match + 检测 gate | 编译错误 |
| B7 ⚠ | `src-tauri/src/state.rs` | 启动时 per-engine 预热 | 首次使用该引擎时冷启动延迟/状态缺失 |
| B8 ⚠ | `src-tauri/src/session_management.rs` | `get_engine_config` per-engine 分支 | Session 管理读不到该引擎配置 |
| B9 🔵 | `src-tauri/src/engine_policy.rs` | 若新引擎要默认禁用：仿 `GEMINI_RUNTIME_ENABLED` 加编译期常量，并接线 `engine_enabled_in_settings` / `sanitize_engine_gates` / `resolve_engine_type` / manager / commands | 编译期开关是多点短路，只改一处会行为不一致 |
| B10 🔴 | `src-tauri/src/engine/<name>.rs` + `<name>_history.rs` + `<name>_provider_profile.rs` | 最小三件套：进程/session 管理 + 历史 + provider profile（参照 `kimi.rs`/`grok.rs` 布局；复杂引擎参照 `claude/` 目录模式或 `codex/` 顶级模块模式） | — |

### C. Capability 治理层（SSOT → codegen → CI）

| # | 文件 | 职责 | 漏掉的后果 |
|---|------|------|------------|
| C1 🔴 | `openspec/specs/engine-capability-matrix/fixtures/matrix.json` | capability 事实源，加新引擎行（15 个 capability key 全填） | matrix gate 失败 |
| C2 ⚠ | `scripts/check-engine-capability-matrix.mjs` | **`ENGINE_VARIANTS` 硬编码六引擎，必须同步改脚本本体**，然后 `--write` 重新生成 `src/features/engine/generated/engineCapabilityMatrix.generated.ts` 与 `src-tauri/src/engine/capability_matrix.generated.rs` | 只改 fixture 不改脚本 → 生成物缺新引擎段，**所有 capability 查询对该引擎返回 `unknown`**，UI 能力降级全失效 |
| C3 ⚠ | `scripts/check-engine-adapter-registry.mjs` | `expectedBuiltins` 硬编码六 id，同步改脚本本体 | 同 C2，gate 变绿但 registry 实际不齐 |
| C4 ⚠ | `scripts/check-model-provider-catalog.mjs` | 硬编码引擎列表（当前含 codex/gemini/grok/kimi/opencode，**无 claude**）；同步后更新 `src/features/models/generatedModelCatalog.json` + `generatedModelFallbacks.ts` | 模型 fallback roster 缺失，模型选择器空白 |
| C5 ⚠ | `scripts/scan-engine-name-branches.mjs` | 扫描 `engine === "<id>"` 型分支生成 inventory；**exit 0 只代表扫描成功**，review 必须核对 finding count，新分支要进 capability policy 或加 `capability-router-allow-engine-branch` 豁免注释 | 散落的 engine-name 分支脱离治理 |

自检：`pnpm check:engine-capability-matrix && pnpm check:engine-adapter-registry && pnpm check:model-provider-catalog && pnpm check:capability-aware-policy-router && pnpm check:engine-controller-facade`

### D. 幕布渲染层（Native live + history 投影）⚠ 接入事故高发区

| # | 文件 | 职责 | 漏掉的后果 |
|---|------|------|------------|
| D1 🔴 | `src/features/threads/adapters/<engine>RealtimeAdapter.ts` + `realtimeAdapterRegistry.ts` | runtime event → `NormalizedThreadEvent`；registry 是 `Record<ConversationEngine, …>` 穷举类型 | 编译错误（有兜底，好事） |
| D2 ⚠ | `src/features/threads/loaders/<engine>HistoryLoader.ts` + `src/features/threads/hooks/useThreadActions.historyLoaderFactory.ts` | history 投影；factory 是按 threadId 前缀的 if 链 | **漏加分支则历史加载静默落到 codex loader**，解析出错乱内容 |
| D3 ⚠ | `src/features/threads/contracts/conversationCurtainContracts.ts` | `ConversationEngine` union + `NORMALIZED_EVENT_DICTIONARY`（引擎私有事件名 → canonical kind） | 新引擎的私有事件**被静默丢弃**，幕布缺整类条目 |
| D4 ⚠ | `src/features/messages/timeline/components/TimelineRowRenderer.tsx` | **streaming 态白名单**（当前硬编码六引擎）+ codex collaboration badge | **新引擎不在白名单 → assistant 消息永远不显示 streaming 光标/进行态**，这是"幕布缺渲染"的头号病灶 |
| D5 ⚠ | `src/features/messages/components/MessagesCore.tsx` | process/explore 折叠白名单、usage 收尾展示白名单、user-input 节点白名单、heartbeat pulse 白名单（多处硬编码） | 对应区块对新引擎静默不渲染 |
| D6 ⚠ | `src/features/app/hooks/useAppServerEvents.ts` | `inferRawMethodEngine()` switch（`"<engine>/raw"` 方法名 → engine）+ threadId 前缀推断 + reasoning delta 的 engineHint 分支 | 事件路由不到新引擎，live 投影静默丢失 |
| D7 🔵 | `src/conversation-presentation/presentationProfile.ts` + `src/features/threads/assembly/conversationMigrationGates.ts` | 渲染节奏/throttle profile 与 assembly 迁移 gate | 缺省走 fallback profile，通常可接受；需要专属节奏时才加 |
| D8 🔵 | `src/utils/threadItems.ts` | canonical item 归一化；一般免改，仅参照 codex generated-image / serverLabel 特例 | 只有新引擎有私制品类时才动 |
| D9 🔵 | `TokenIndicator.tsx` / `ContextBar.tsx` | usage 展示；通用 `usedTokens/maxTokens` 路径自动可用 | 专属 usage 卡片（如 ClaudeContextCard）按需接线 |

自检（哨兵）：`rg -n '"<new-engine>"' src/features/messages src/features/threads src/conversation-presentation src/features/app/hooks/useAppServerEvents.ts` —— 返回不应为空；再跑 `pnpm vitest run src/features/threads/adapters/realtimeAdapters.test.ts src/features/threads/loaders` 验证 live/history parity。

### E. Composer / 选择器层

| # | 文件 | 职责 | 漏掉的后果 |
|---|------|------|------------|
| E1 ⚠ | `src/features/composer/components/ChatInputBox/ChatInputBoxAdapter.tsx` | `engineToProvider()` switch + `engineDisplayName: Record<EngineType, string>` + `providerModelCatalogs` | **漏了 switch 分支 → provider 图标/模型组静默落到 claude** |
| E2 ⚠ | `src/features/composer/components/ChatInputBox/types.ts` | `AVAILABLE_PROVIDERS` 硬编码数组 + `enabled` flag | 新引擎不出现在 provider picker |
| E3 🔵 | `src/features/composer/components/ChatInputBox/modelOptions.ts` | `MODEL_CONFIG_PROVIDERS` + 自定义模型存储（`features/models/<engine>CustomModels.ts`） | 仅当该引擎要"自定义模型"能力时接 |
| E4 🔵 | `src/features/engine/hooks/engineControllerCatalog.ts` | model catalog 投影分支（claude/gemini 有特判） | 需要 fallback 模型目录合并时接 |
| E5 ⚠ | `src/features/engine/components/EngineIcon.tsx` + `src/assets/model-icons/` + `src/features/vendors/providerBrandIcon.ts` | engine→图标 switch；provider 品牌图标正则映射 | 落到默认图标（不报错但品牌识别错误） |
| E6 🔵 | `src/app-shell-parts/modelSelection.ts` | `isReasoningEffortSupportedForEngine()` 硬编码分支 | 仅当支持 reasoning effort 时接 |
| E7 ⚠ | `src/features/composer/hooks/cliEngineVisibilityStore.ts` + `AppSettings.disabledCliEngines` | 引擎可见性两层开关 | 新引擎默认行为要明确（默认可见 or 默认隐藏） |
| E8 ⚠ | `src/features/engine/utils/engineImageInput.ts` | `ENGINE_IMAGE_LABEL` Record（附件不支持提示文案） | 提示文案显示原始 engine id |
| E9 🔵 | `src/features/threads/hooks/useQueuedSend.ts` | 斜杠命令 / `/clear` / resume 语义的 per-engine 守卫 | 按需评估，无强制注册点 |

### F. Shared 层（前后端双写集合，必须同集合）

| # | 文件 | 职责 | 漏掉的后果 |
|---|------|------|------------|
| F1 ⚠ | `src/features/shared-session/utils/sharedSessionEngines.ts` **↔** `src-tauri/src/shared_sessions.rs` | `SHARED_SESSION_SUPPORTED_ENGINES` Set ↔ `is_supported_shared_session_engine()` **双集合手工同步**（当前均为 claude/codex/kimi/grok/opencode，排除 gemini） | 前端漏加 → `normalizeSharedSessionEngine()` **把新引擎静默改写成 claude**；后端漏加 → Shared 发送报 Unsupported |
| F2 ⚠ | `src-tauri/src/shared_session_v2.rs` | `context_capabilities()` / `engine_runtime_key()` / native session id 恢复三处 per-engine match | Shared V2 对新引擎落到 `_` fallback 或直接缺能力画像 |
| F3 ⚠ | `src-tauri/src/shared_runtime_coordinator.rs` | `shared_pending_id` normalize match + engine→字符串 match | pending-id 归属错乱 |
| F4 ⚠ | `src-tauri/src/shared_projection/commands.rs` | 投影能力 match + 支持引擎数组 | Shared 投影对新引擎不可用 |
| F5 ⚠ | `src-tauri/src/shared_sessions.rs` | pending-id 前缀（`<engine>-pending-shared-`）+ 发送 dispatch match | pending 状态无法识别 |
| F6 🔵 | `src-tauri/src/native_continuation/commands.rs` + `src-tauri/src/native_history/types.rs` | Native 续写/history 读取门 | 仅 L3 档位接入 |
| F7 — | `src/features/shared-session/runtime/sendSharedSessionTurnV2.ts` | **通常免改**：engine 经 target 透传，前提是 F1 集合已含新引擎 | — |

自检：`pnpm vitest run src/features/shared-session/utils/sharedSessionEngines.test.ts` + 人工 diff 前后端两个集合。

### G. UI 展示层（Settings / Sidebar / Session 管理）

| # | 文件 | 职责 | 漏掉的后果 |
|---|------|------|------------|
| G1 ⚠ | `src/features/vendors/components/VendorSettingsPanel.tsx` + per-engine `*ProviderList/Dialog` + provider management hooks | CLI 配置管理主面板 | Settings 里该引擎无配置入口 |
| G2 ⚠ | `src/features/vendors/components/CliCustomPathDialog.tsx` | `CliCustomPathEngine` union（当前五引擎，无 gemini） | 无法配置自定义 CLI 路径 |
| G3 ⚠ | `src/features/settings/components/SettingsView.tsx` | per-engine doctor handlers（`onRun<Engine>Doctor`）+ `resolveSessionEngine()` + session counts | doctor 与 session 统计缺该引擎 |
| G4 ⚠ | `src/features/app/hooks/useSidebarMenus.ts` | `iconKind` union（`engine-<id>`）+ 每引擎 new-session 条目块 + `sharedEngineLabels` | 侧栏新建入口缺该引擎 |
| G5 ⚠ | `src/features/app/components/Sidebar.tsx` icon switch + `src/features/app/components/ThreadList.tsx` `baseEngineTitle` + badge | 侧栏/会话列表的引擎标识 | 会话行无引擎徽章或显示错误名 |
| G6 ⚠ | `src/features/settings/components/settings-view/sections/SessionManagementSection.tsx` | per-engine 历史解析器 import / filter label / 加载分支 | Session 管理页过滤缺该引擎（**已知现存缺口：grok/kimi 当前也未覆盖**，接入时参照现状决定是否补齐） |
| G7 ⚠ | `src/features/home/components/HomeChat.tsx`（`getEngineLabel`）+ `ChatInputBox/PromptEnhancerDialog.tsx`（同名局部函数） | 首页与 prompt 增强对话框的引擎标签 | 显示原始 id |

### H. i18n 层（10 语言 × N namespace）

| # | 文件 | 职责 | 漏掉的后果 |
|---|------|------|------------|
| H1 🔴 | `src/i18n/locales/<lang>/workspace.ts`（`engine<Name>` key）+ `providers.ts` + `sidebar.ts` + `settings.ts` + `runtimeNotice.ts` | 引擎名称、provider 文案、状态文案、resume/recover 文案 | locale parity 测试失败 |
| H2 🔵 | `claudeModes.ts` / `codexModes.ts` 同类 modes 文件 + `<lang>/index.ts` 登记 | 仅当引擎有 mode 概念 | — |
| H3 🔴 | parity 守卫：`chatLocaleMerge.test.ts` / `sharedSendLocaleParity.test.ts` / `subagentUiLocaleParity.test.ts` / `noteCardsLocaleParity.test.ts` / `zh/sidebar.test.ts` | 10 语言（en/es/fr/hi/ja/ko/pt-BR/ru/zh/zh-TW）key 对齐 | 测试兜底 |

语言列表以 `ls src/i18n/locales/` 实查为准（当前 10 个）。

### 矩阵使用纪律

1. **逐行勾选，🔵 项写决策记录**："不需要"也是结论，写在 PR 描述里，防止后人以为漏了。
2. ⚠ 行全部人工核对——**它们没有编译器/测试兜底**，是历次"缺东少西"事故的全部来源。
3. 完整接入样例参照 `openspec/changes/archive/2026-07-24-add-kimi-engine/`（proposal/design/tasks/specs 四件套）。

---

## 一、心智模型与接入分级

### 1.1 概念角色 vs 真实代码

本文中的 `RuntimeDeliveryAdapter`、`RuntimeCapabilities`、`NativeEventNormalizer`、`NativeHistoryReader` 是**架构角色名**，不保证仓库中存在同名 export。真实落地形态见 §0 矩阵：Rust 侧是 `engine/<name>.rs` 三件套 + dispatch match 群，前端侧是 RealtimeAdapter / HistoryLoader / 渲染白名单群。

`registerExternalEngine()` 当前只验证并返回 registry entry；它**不是**完整的 dynamic plugin runtime，也不会自动生成 Rust adapter、capability、history、Shared 或 security wiring。

### 1.2 接入前必须建立的心智模型

| 概念 | 一句话 | 基石设计 |
|---|---|---|
| Engine ≠ Provider ≠ Model | CLI 是执行者，Provider 是通信配置，Model 是本 Turn 的选择，三者正交 | §2.1 |
| Capability 不靠猜 | 一切能力由运行期 Probe 得到，禁止按 Engine 名字硬编码假设 | 红线 20/26 |
| ACK 分级 | Process Spawn、stdin write、first token 都不是 ACK；每个 Adapter 用自己的协议证据 | §14.3.1 |
| Terminal 与 cleanup 分域 | Provider typed final/result 决定 Shared logical settlement；process/stdio/hook cleanup 不能拖住 Composer | §14.2.2.1 |
| Intent Before Side Effect | 调用外部 CLI 之前，对应 Intent 必须先 Durable | §14.2.2、红线 25 |
| 降级是合法的 | 能力弱的 CLI 走 `portable-transcript`/`checkpoint` + `ackFidelity = weak`，不假装 exactly-once | §9.2、§14.3.5 |
| Canonical writer 单一权威 | Adapter 只产生 typed evidence；Canonical Fact 由 Shared core 统一序列化和持久化 | §14.4.4.1 |
| Recovery owner 隔离 | Shared Attempt/Binding recovery 不得回退 Native resume/rebind/fork | §14.4.7.1 |

### 1.3 接入形态分级：先想清楚做到哪一档

不是每个 CLI 都要一次做满。按基石设计的 capability 语义，接入分四档，**每档都是合法的终点**：

| 档位 | 能力 | 对应现状参照 | 矩阵范围 |
|---|---|---|---|
| **L0 Minimal** | prompt wrapper + weak ACK（`inputAck: "first-event"` 或 `"none"`） | 当前 Kimi prompt adapter | A+B+C+D（基础）+E（基础） |
| **L1 Standard** | 明确 Input ACK（request-response 或 echo）+ 可靠 Terminal + Pending Probe | Claude | L0 + D 全量 + F1-F5 |
| **L2 Full** | L1 + structured history import 或 native clone | Codex | L1 + G+H 全量 |
| **L3 Continuation** | L1/L2 + NativeHistoryReader，解锁 Provider Continuation | Claude/Codex（Change D） | L2 + F6，独立追加 |

**决策建议**：新 CLI 一律从 L0/L1 切入，用真实流量验证 ACK 语义后再评估 L2。L3 永远后置，它不阻塞 Shared Session 的任何能力。**Shared 资格（F 组）不是默认义务**——进不进 `SHARED_SESSION_SUPPORTED_ENGINES` 是显式决策，不进则该引擎只在 Native 模式可用（Gemini 即此形态）。

---

## 二、Phase S：Capability Spike（纯调研，不写产品代码）

这是整个接入流程的第一步，也是纪律性最强的一步：**Spike 结论落档之前，禁止写 Adapter contract**。基石设计把这条列为 Phase 0 验收项（"Adapter contract 不以 CLI 文案或假设为依据"）。

### 2.1 Spike 任务模板

复制以下清单，把 `<NEW_CLI>` 替换为目标 CLI，逐项实测并记录证据（命令、输出片段、版本号）：

#### A. 二进制与协议身份

- [ ] Binary identity：可执行文件名、`--version` 输出格式、安装渠道
- [ ] 协议形态：stream-json / JSON-RPC / ACP / 私有 stdio / HTTP？
- [ ] 协议版本获取方式：`--help`、握手响应、schema 文件？
- [ ] Schema fingerprint 可计算吗（用于 §14.3.1 的 Capability Cache Key）

#### B. Session 生命周期

- [ ] 如何创建 Session：显式命令（如 `thread/start`、`session/new`）还是首个 prompt 隐式创建？
- [ ] Session Identity 以什么形式、在哪个事件/响应中返回？
- [ ] 如何 Resume：`--resume` / `session/load` / 其他？Resume 后历史如何呈现？
- [ ] 支持 Fork/Clone 吗（`--fork-session` 类能力）？→ 决定 §9.2 的 `native-history-clone` 可用性

#### C. Input / Output 通道

- [ ] User input 投递方式：stdin prompt、JSON-RPC method、文件？
- [ ] 支持 image/attachment 输入吗？格式？
- [ ] Output event 流格式：NDJSON event 类型清单、thinking/tool/error 各如何表达？

#### D. ACK 语义（最重要，逐条实测）

- [ ] **Input ACK**：投递后有 request-response 确认吗？有 echo 吗（如 Claude `--replay-user-messages`）？还是只能等第一个合法 event（弱 ACK）？
- [ ] **Run Started**：有显式 started 事件，还是只能从第一个 assistant/tool event 推断？
- [ ] **Terminal**：有显式 completed/result 事件吗？Provider rejection 是否可能伪装成 synthetic assistant（camel/snake error flags）或 `result.is_error`？Process Exit 与 Terminal 冲突时哪个为准？
- [ ] **Cleanup**：typed final 后还有哪些 process/stdio/hook/MCP child/usage 清理事件？它们会延迟多久，是否可能不退出？
- [ ] **Duplicate Final**：typed final、cumulative full snapshot、process-exit fallback 是否可能重复表达同一结果？
- [ ] **Pending Probe**：投递后 ACK 丢失时，能按 client-supplied id 或 native history 查询"刚才的输入到底进没进去"吗？
- [ ] **Cancel**：能取消一个已投递但未确认的 delivery 吗？取消有 ACK 吗？（→ `pendingCancel` 枚举）

#### E. History 能力

- [ ] 支持 arbitrary history import 吗（如 Codex `thread/inject_items`）？支持哪些 item 类型？可 read-back 验证吗？重复注入行为？
- [ ] History 存储在哪：vendor file 路径、格式（JSONL/SQLite/其他）、append-only 吗？→ 决定 L3 的 NativeHistoryReader 可行性
- [ ] History 里有 stable cursor 吗（byte offset / line number / entry id）？

#### F. Provider / Model / 配置

- [ ] Provider 配置机制：env、config file、CLI flag？支持多套并行配置吗（同一 CLI 两个 Provider 进程隔离）？
- [ ] Model 列表获取方式：CLI 命令、API、静态？
- [ ] Reasoning/thinking 配置入口？
- [ ] MCP / tools 支持矩阵

#### G. Usage 报告

- [ ] 有 usage/token 统计输出吗？per-turn 还是累计？有稳定 subject id 吗？（→ 基石设计 §14.2.1 Usage Fact 的 `reportSubjectId` 来源）

### 2.2 Spike 产出物

一份落档到 `docs/research/` 的 capability matrix（参照基石设计 §14.3.2 的表格格式），必须包含：

```text
| 维度 | 实测结论 | 证据 | 对应 RuntimeCapabilities 字段 |
```

外加一个明确的分档结论：**本 CLI 首期目标档位（L0/L1/L2）+ 理由 + Shared 资格决策（进/不进 `SHARED_SESSION_SUPPORTED_ENGINES`）**。这份文档是后续 Adapter 的唯一事实来源——Adapter 里出现的每一个能力假设，都必须能指回 Spike 证据。

---

## 三、接入实施：按矩阵分层落地

实施顺序 = §0 矩阵的 A → B → C → D → E → F → G → H。每层完成后跑该层自检命令再进下一层。以下只补充矩阵之外的架构义务。

### Step 1（A+B 层）：Engine identity 与 Rust runtime

- Rust 的 exhaustive match 会强制编译器列出所有集成点——逐个过一遍，每一处决定"新 CLI 在此处的行为"。
- 序列化兼容：Engine 在 DB/JSONL 中以字符串存储。新增 variant 后，用存量 fixture 跑一次反序列化回归（确认旧版本 mossx 读到新 engine 字符串时是 typed unknown，不是 panic）。
- **别忘了 A5 daemon 平行枚举**——`engine_bridge.rs` 用 `#[path]` include 每个 per-engine 文件，主 crate 编译过不代表 daemon 编译过。
- Provider Profile 是**配置数据**不是代码（基石设计 §10）；Runtime Owner key = `Workspace Owner + Engine + Provider Profile`，用两个 Provider 并行各发一个 Turn 验证隔离（§17.2）。
- Credential resolution 遵守 `Turn explicit managed binding > Session persisted managed binding > explicit local/default`（§10.3）。

### Step 2（B10）：Delivery 语义（Adapter 核心纪律）

按 Spike 结论诚实填写 ACK 语义：

| Spike 结论 | `inputAck` 填法 | ACK 实现 |
|---|---|---|
| 有 request-response（如 JSON-RPC 200 + turn id） | `"request-response"` | response 成功 + 拿到 native turn identity 才算 ACK |
| 有 echo（如 Claude replay） | `"echo"` | echo 内容与 `clientTurnId`/checksum 匹配才算 ACK |
| 只有第一个合法 event | `"first-event"` | 明确标记弱语义，文档与 UI 不假装 exactly-once |
| 什么都没有 | `"none"` | 只能配合强 `pendingProbe` 使用，否则该 CLI 不进 Shared V2 |

**禁止事项**（对应红线 26）：

- 不得把 process spawned、stdin write success、first token 当作 ACK 返回；
- 不得为了让 matrix 好看而上报未实测的能力；
- 不得在 Adapter 内做自动重试/自动 failover（重试决策属于内核 + 用户）；
- 不得把 accepted start ACK 当作 completed；Shared completion 由 exact Attempt waiter 等待 logical terminal；
- 不得让 frontend 根据 Engine 名称、inline event 是否到达或 timeout 猜测 terminal。

### Step 3（C 层）：Capability 治理

- 先改 `openspec/specs/engine-capability-matrix/fixtures/matrix.json`，**再改三个 gate 脚本内的硬编码引擎列表**（C2/C3/C4），最后 `--write` 重新生成。顺序错了会出现 gate 绿但生成物缺段的假绿。
- 填 capability 时逐条引用 Spike 证据编号。

### Step 4（D 层）：幕布投影（事故高发，逐条核对）

- RealtimeAdapter 把 native event 归一到 `run:start / turn:start / message:delta / tool:start|update|end / turn:end / run:settled` 最小事件面；**不改** `MossxAgentEvent` 既有 event meaning（红线 32），新事件类型用 additive envelope 扩展，并在 `NORMALIZED_EVENT_DICTIONARY`（D3）登记私有事件名。
- Terminal 边界可判定：Provider typed final/result 归一为 Attempt-owned `run.settled`；Shared logical settlement 与 runtime cleanup 分域。
- 对 synthetic assistant API error（含 camelCase/snake_case 字段）与 error result 单独做
  Spike；若为 authoritative rejection，Adapter MUST 立即 settle 并结束 exact process owner，
  不得继续等待 stdout/EOF。
- 同一 `attemptId + runtimeTurnId` 的 duplicate final / cumulative full observation / 迟到 `TurnCompleted` 必须幂等吸收。
- Runtime send 返回 exact identity 前到达的事件进入 bounded hold/replay barrier；绑定 exact Shared owner 后按原顺序释放。
- streaming delta 走既有 `liveAssistantTextChannel` 外部化通道（红线 35），不开第二条 delta 路径。
- **D4/D5/D6 三组渲染白名单逐个加新引擎**——这是本层唯一没有编译器兜底的部分，加完后在真实会话里目视验证：streaming 光标、reasoning 折叠、usage 收尾、tool 块四件套全部出现。
- 新 CLI 不拥有 Canonical persistence：Adapter 只输出 typed ACK/terminal/usage/control evidence，Canonical Fact 由 Shared core 统一序列化落盘；禁止 Adapter/delivery/frontend 手工构造 `NewCanonicalEvent`。
- Shared 与 Native 可复用底层 CLI protocol parser，但不能复用 recovery owner。

### Step 5（E+G+H 层）：选择器 / Settings / i18n

- Composer 侧先过 `engineToProvider`（E1）——它决定 provider 图标与模型组归属，漏了不报错但视觉错位。
- `AVAILABLE_PROVIDERS` 的 `enabled` flag（E2）与 `disabledCliEngines`（E7）是两层开关，默认行为要显式决策。
- **不为新 CLI 加任何"特殊 UI 逻辑"**。如果觉得需要，先停下来检查是不是 capability 建模错了——UI 只读 capability 和 snapshot。
- i18n 按 H1 清单 × 10 语言提交；`settings.ts` 是大头（per-engine 配置 key），不要只翻 en/zh。

### Step 6（F 层）：Shared 资格（显式决策）

- 决策"进 Shared"时：F1 前后端双集合同 PR 同步，F2-F5 逐处 match 加分支，跑 Shared negative-path tests。
- 决策"不进 Shared"时：在 Spike 产出物里写明理由（参照 Gemini：runtime policy 禁用 + 排除在支持集合外），UI 侧该引擎在 Shared Target Picker 中 disabled 并显示 capability reason，**不静默隐藏**。
- local/disk profile sentinel 只用于读取配置，进入 Shared `ExecutionTarget` 前归一为 `providerProfileId = null`。

### Step 7（F6，可选，L3）：NativeHistoryReader

仅当需要为该 CLI 解锁 Provider Continuation 时做：

- 实现基石设计 §9.1.1 的只读接口：`probe` 报告 `readable / stableCursor / currentThroughCursor / supportedEntryTypes`；`read` 输出 canonical-shaped `ContextSourceEntry`；
- 硬约束：不修改 vendor history file（红线 21/37）；无 stable cursor 时 `stableCursor = false` → Continuation 对该 CLI typed unsupported、fail closed，**这是合法终点**；
- 在分配完整 buffer 前检查 file byte limit；blocking file read 必须移出 async runtime worker；
- portable block 必须 allowlist；Tool Call/Result 必须成对保留或成对 omission；
- Reader 输出不进 Shared Event Log，只供 ContextCompiler。

---

## 四、测试要求（不可裁剪）

新 Adapter 必须通过基石设计 §14.3.5 的统一 Contract Test Suite，一项都不能少：

| # | 测试 | 验证什么 |
|---|---|---|
| 1 | request accepted / rejected | 基本投递语义 |
| 2 | accepted 后 connection drop | ACK 与现实的裂缝 → ambiguous 路径 |
| 3 | first event 前 crash | 弱 ACK CLI 的恢复定性 |
| 4 | duplicate typed final / late cleanup terminal | `run.settled`、Assistant Final 与 `turnCommitted` 都 exactly-once |
| 5 | Resume 后 Probe | pendingDelivery 恢复 |
| 6 | Provider A/B 相同 Engine 并行 | Runtime 隔离不串线 |
| 7 | unsupported capability 降级 | transcript/checkpoint 自动兜底 |
| 8 | schema/version 变化 | 重新 Probe，不用旧能力解释新 binary |
| 9 | typed final 后 process 继续存活 | Shared Composer 立即 idle；cleanup 独立完成 |
| 10 | Shared Stop / cancel race | 命中 exact Attempt owner；cancel ACK/typed cancellation 结算为 `cancelled`，已抢先完成的合法 terminal 可以保持 `completed`；最终 exactly-once |
| 11 | send 返回 accepted，但 frontend 未收到 inline terminal | backend waiter 仍从 durable settlement 收口 |
| 12 | early event before exact native identity | hold/replay 后只投影 Shared，不泄漏 Native row |
| 13 | Canonical envelope | 新 Fact 的 payload `type` 与 row `fact_type` 一致 |
| 14 | Shared projection failure | 保持可重试，不调用 Native recovery，不显示 Native recovery card |
| 15 | Native Session 对照 | Native history、live terminal、stop 与 recovery 行为不变 |

另外两项接入级验收：

- **Fault injection**：复用 A1.5 的强杀测试台，在 Tx 2a（provisioning）/ Tx 3（delivery）/ Tx 4（ACK）/ Tx 5（commit）四个边界各杀一次，验证新 CLI 路径不丢输入、不重复投递、不盲建第二 Binding；
- **存量 fixture 回归**：跑 Claude/Codex/Kimi 的 golden fixtures（`src-tauri/tests/fixtures/session-foundation/`）与 live/history parity 测试（`realtimeAdapters.test.ts`、`historyLoaders*.test.ts`、`realtimeHistoryParity.test.ts`），证明新 CLI 的接入对存量引擎零影响。

**渲染层目视验收（D 层补充，无自动化兜底）**：用新引擎跑一个真实会话，目视确认 ① streaming 光标/进行态 ② reasoning 块折叠 ③ tool 块渲染 ④ usage 收尾 ⑤ 历史 reload 后与 live 一致。五项缺任意一项，回 §0 D 组找漏掉的白名单。

---

## 五、存量行为防回归清单（必须为零）

接入完成后，用这张表证明存量行为没有回归：

- [ ] 存量 Engine 的事件含义、顺序、Terminal settlement 未变（红线 32）
- [ ] 存量 Shared 会话的 Canonical Entry、Cursor、Binding 状态未被触碰（新 CLI 只产生新 `bindingKey`）
- [ ] 存量 Native Session 不经过任何新代码路径（additive routing）
- [ ] Shared typed final 可以在 process cleanup 前收口；Native CLI 原有 cleanup lifecycle 未被全局改写
- [ ] `ConversationItem` / `threadItems.ts` / `liveAssistantTextChannel` 无改动（红线 31/34/35）
- [ ] 老 Shared 会话切到新 CLI Target 时：新 Binding lazy create，老 Binding 保留；切回时 `native-delta` 复用（§8.3）
- [ ] 新 CLI 的 weak ACK 没有污染全局 exactly-once 语义（降级显式可见）
- [ ] Shared history error 不进入 Native recovery；Shared title 变化后仍按同一 `shared:<UUID>` 恢复
- [ ] 既有引擎的渲染白名单分支未被顺手"重构"（接入 PR 只做 additive，白名单里只追加不重排）

---

## 六、完整示例：假设接入 Auggie CLI

一个端到端的推演，展示各决策点如何使用本指南（Grok 已是 built-in，故换一个假想对象）：

```text
Phase S Spike 实测（假想结论）:
  - 协议: stream-json over stdio，无 handshake 版本 → schema fingerprint 用 binary version 兜底
  - Session: 首个 prompt 隐式创建，session id 在 system init event 返回
  - Resume: --resume <id> 支持；无 fork/clone
  - Input ACK: 无 response、无 echo；第一个 assistant event 是唯一信号
  - Terminal: result event 存在；process exit 只表示 cleanup 完成
  - Pending Probe: 无 client id 机制；可读 ~/.auggie/sessions/*.jsonl（append-only）
  - History Import: 无
  - Usage: result event 含 per-turn tokens，有 turn id

→ 分档结论: L0+（prompt wrapper + first-event 弱 ACK + by-native-history probe）
→ Shared 决策: 进 Shared（弱 ACK 合法，pendingProbe 走 by-native-history）

落地（按 §0 矩阵）:
  A 层  EngineType += "auggie"（编译器列出全部集成点）+ engineIds.json + daemon 平行枚举
  B 层  engine/auggie.rs + auggie_history.rs + auggie_provider_profile.rs 三件套；
        manager/status/commands/events 四个 dispatch；command_registry 注册 session 三件套命令
  C 层  matrix.json +auggie 行 → 改三个 gate 脚本硬编码列表 → --write 重新生成
  D 层  auggieRealtimeAdapter + auggieHistoryLoader + factory 分支 + 事件字典登记；
        TimelineRowRenderer/MessagesCore/useAppServerEvents 三组白名单逐个 +auggie；
        目视验收四件套（streaming/reasoning/tool/usage）
  E 层  engineToProvider + engineDisplayName + AVAILABLE_PROVIDERS + EngineIcon + i18n label
  F 层  sharedSessionEngines.ts ↔ shared_sessions.rs 双集合同 PR +auggie；
        shared_session_v2 三处 match + 投影支持数组
  G 层  VendorSettingsPanel provider 管理 + CliCustomPathDialog + Sidebar 条目
  H 层  workspace/providers/sidebar/settings/runtimeNotice × 10 语言

验收:
  - 15 项 Contract Tests 全过（其中 #2/#3/#9 是弱 ACK + 独立 cleanup 的重点）
  - Shared 会话 Claude → Auggie → Claude：auggie 走 checkpoint 降级（用户可见确认），
    切回 Claude 时 native-delta 只补增量
  - 渲染层目视验收五项全过
  - 存量 fixtures 全绿
```

---

## 七、常见反模式（接入时自我检查）

1. **"先接上跑起来，ACK 以后再说"** → 违反 Intent-before-side-effect；弱 ACK 可以，但没有 Probe 手段的 CLI 不能进 Shared V2。
2. **"它文档说支持 X"** → 文档不是证据，Spike 实测才是。填 capability 时引用 Spike 证据编号。
3. **"给它的 transcript 里塞多角色历史就当 history import"** → 那是 `portable-transcript`，user-channel transport，不宣称 lossless replay（§9.2 表格）。词不准会导致后续恢复语义全错。
4. **"手改它的 session 文件注入历史"** → 红线 21 禁止；只接受官方 import/fork/clone 协议。
5. **"为新 CLI 在内核加 if engine == 'auggie'"** → 所有 Engine 特判必须收敛到 Adapter 或 capability predicate；内核出现 engine 分支即设计腐化信号。
6. **"顺便优化一下存量 Adapter"** → 接入 PR 只做 additive；存量行为变更独立成 Change。
7. **"前端看到回复正文就结束 Shared Turn"** → 正文是 presentation evidence，不是 terminal authority；等待 backend exact-Attempt settlement。
8. **"等 CLI 进程完全退出再结束"** → 混淆 logical settlement 与 cleanup；typed final 到达后立即收口 Shared，cleanup 独立执行。
9. **"这个 CLI 特殊，自己写一条 event row"** → 破坏 canonical envelope 单一权威；只向 coordinator 提交 typed evidence。
10. **"Shared history 失败就调用普通 Session 恢复"** → recovery owner 串线；Shared 只走 canonical/Legacy Shared read path。
11. **"用会话标题找回 Shared history"** → 标题可变且可重复；只使用 `shared:<UUID>`。
12. **"主 crate 编译过了就是接完了"** → daemon 平行枚举（A5）、gate 脚本硬编码列表（C2/C3/C4）都不在主编译路径上，必须单独核对。
13. **"测试全绿 = 渲染没问题"** → D4/D5/D6 渲染白名单没有任何自动化兜底；测试全绿但幕布缺 streaming 态是真实发生过的接入形态，必须目视验收。
14. **"前端加了 Shared 集合就够了"** → F1 是双写集合，只加一边会出现"目标被静默改写成 claude"或"发送报 Unsupported"的幽灵 bug。

---

## 八、索引

- 基石设计（契约与红线）：[`mossx-multi-cli-provider-session-foundation-design.md`](./mossx-multi-cli-provider-session-foundation-design.md)
  - §3.2 Provider/Protocol 正交 · §9.1.1 NativeHistoryReader · §9.2 五种 Projection Mode · §14.2 Canonical Turn Contract · §14.3 Capability/ACK Matrix · §14.4.4.1 Canonical envelope · §14.4.7.1 Recovery ownership · §19 设计红线
- 实施任务清单（Wave 0 Spike 模板来源）：[`../plans/2026-07-27-multi-cli-provider-session-foundation-task-checklist.md`](../plans/2026-07-27-multi-cli-provider-session-foundation-task-checklist.md)
- 完整接入 change 样例（四件套模板）：`openspec/changes/archive/2026-07-24-add-kimi-engine/`
- 相关 specs：`openspec/specs/engine-capability-matrix/`、`engine-adapter-protocol-registry/`、`engine-runtime-identity/`、`shared-session-engine-selection/`、`cli-engine-visibility/`、`engine-plugin-onboarding-kit/`
- 现有 Adapter 参照实现：`src-tauri/src/engine/claude.rs`、`src-tauri/src/engine/kimi.rs`、`src-tauri/src/engine/grok.rs`、`src-tauri/src/shared/codex_core.rs`
- Golden fixtures：`src-tauri/tests/fixtures/session-foundation/`
