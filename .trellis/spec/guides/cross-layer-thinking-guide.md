# Cross-Layer Thinking Guide（跨层思考指南）

## doge 的主链路

```text
React Component
  -> Feature Hook
  -> Service Wrapper (src/services/tauri.ts)
  -> Tauri Command (Rust)
  -> Storage / Engine Runtime
  -> Response Mapping
  -> UI State + Render
```

## 高风险边界（High-Risk Boundaries）

- hook <-> `services/tauri.ts`
- `services/tauri.ts` <-> Rust command 参数/字段
- `services/dragDrop.ts` <-> Tauri `onDragDropEvent` / forwarded WebView drag-drop event
- client storage <-> runtime default/fallback
- i18n key <-> UI copy fallback

## 变更前必做

1. 列出所有受影响 command/event/payload 字段。
2. 明确 request 与 response 的 mapping 方向。
3. 定义 fallback（Tauri 不可用 / web-service mode）。
4. 先定义验证策略再写代码。
5. 禁用 capability 时按“行为入口”盘点 UI、legacy config replay、后台任务、sync/async、local/remote；history/filter/diagnostics compatibility 与 execution 必须分开判断。
6. retry/stale guard 必须落在 shared owner boundary；检查是否还有 selection、ensure、cache、fallback 或 timeout sibling caller 能绕过。
7. legacy provider config 归一时，user-confirmed action MAY 选择可见 fallback；无人确认的 background automation MUST fail closed 或自动禁用，禁止静默把数据改发另一个 provider。
8. prompt / policy enablement 发生变化时，必须区分 runtime state 与 persisted thread history：restart process 不代表 resume 的 thread 已忘记旧 instructions；deactivation 需要 authoritative replacement / tombstone 或明确的新 thread contract。
9. realtime 文本若为性能原因绕过 canonical reducer，必须同时审计 terminal settlement -> reducer -> snapshot persistence -> history dual-read 全链路；“实时可见”不等于“durable final 已落盘”。
10. Picker label、IPC payload equality 与模型自报都不是 Runtime routing 证据；Provider
    切换必须观测实际 process/session key、Binding key 与 CLI request model。
11. 一次 mutation 若已有 durable owner，后续 command shape 就不应再接收第二套 owner
    字段。优先让类型层无法表达 `canonical=A/runtime=B`，不要依赖“传两份再比较”。
12. Preview 与 mutation 必须分域：携带 Target 的 `prepare_context` 只能 read-only；
    `begin_turn` freeze 后，delivery/dispatch/commit/control 全部只收 attempt identity。
13. new entity 创建必须从第一笔持久化开始完整。不能先建 Engine-only Shared Session，
    再依赖 global selection 或首次发送补 Provider/Model。
14. UI selection persistence 必须定义失败语义：persist-first 或 compare-safe rollback；
    不能让 memory state 与 disk state 在错误后各自为真。
15. Runtime event 可能早于 start ACK。审计 owner bind、early replay、live ingress 与 UI
    fan-out 的原子顺序；“有缓存”不等于“不会被 bind→emit race 越过”。
16. Cancel/Interrupt 是 owner-scoped lifecycle mutation。先登记 intent 再做 Runtime
    side effect；side effect 失败要撤销 intent，避免把后续真实 failure 误记为 cancelled。
17. Rebuild/Retry/Regenerate 不能成为第二套 routing authority。rebuild target 应由
    durable Binding row 派生；Retry/Regenerate 应由原 Attempt/Snapshot 派生并创建新
    `attemptId`。
18. Shared Runtime ACK 与 terminal 必须按 protocol phase 解耦。`accepted` 只证明
    Runtime 接受执行；Runtime terminal 由 exact Attempt owner 收集，但 UI control flow
    必须通过 backend durable await，以 `conversation.turnCommitted` 作为最终完成证据。
    projected event / Agent Event Bus / inline terminal 只服务 rendering、notification 与
    fast wakeup，不能成为 Composer 结束 authority。禁止按 CLI 名称要求某个 Engine 同步
    返回 terminal；新增 CLI 只需适配同一 ACK/terminal + durable commit contract。
19. Context fidelity diagnostic 与 send authorization 必须分离。成功生成的 degraded
    context 应记录 manifest/diagnostic 并自动 best-effort delivery；只有 package
    preparation、Runtime ACK、Provider rejection 等真实执行错误才阻断发送。禁止把
    “历史无法完整迁移”升级为每次切换 Target 都要人工确认的发送 gate。
20. 修复 terminal UI residue 时，不能只审计 `turn/started`。必须枚举所有 sibling
    propagation path（assistant/reasoning delta、normalized/raw item、batch flush、
    heartbeat）中可写 `processing=true` 的入口。durable control completion 应先用
    exact Runtime identity 安装 terminal barrier，再清 UI；ledger cleanup 只能绑定
    component unmount，禁止绑定会随 rerender 变化的 callback dependency。
21. 长时 Turn 的 timeout 必须按 protocol phase 审计。允许首包、ACK、health probe、
    completion 后 cleanup grace 等 bounded timeout；禁止在 terminal observer、Runtime
    event forwarder 或 accepted owner 上施加从 Turn start 计时的总 deadline。若 observer
    可重附，settlement/removal 必须 broadcast 给同 Attempt 的全部 waiters。
22. reattachment cleanup 必须带 exact owner compare-and-clear。旧 Runtime terminal
    可以为自己的 identity 安装 ledger barrier，但不能用 thread-level cleanup 清掉新
    Attempt 的 processing、active owner 或 frozen Target。
23. 强制 gate / onboarding state machine 的 escape action 必须按全部 authenticated
    blocking states 枚举并由 shared frame owner 渲染；不能只在某个 leaf phase（如
    checkout）补按钮。至少覆盖 loading、catalog、empty、failure、selection、payment、
    preparing，并验证 action pending、failure 与 stale async completion。
24. generation guard 只能决定谁能写结果，不能自动收口 pending UI。凡 async owner 在
    请求前设置 `loading/busy/pending`，必须把该 flag 绑定到 exact generation/request id；
    stale settle 仅清理自己仍拥有的 flag，显式 lifecycle commit（如 logout/change-password
    signed-out）必须同步 invalidate owner 并收敛 UI，避免永久 spinner 或旧请求误清新请求。
25. Renderer readiness 不是 native credential readiness。Engine identity、Provider identity
    与 OS-vault secret availability 必须分别建模；同 engine 的 local/manual → managed Provider
    切换仍是 capability transition。若凭据可被 Keychain/Credential Manager/Secret Service、
    logout、account switch 或外部清理改变，显式 managed transition 必须在创建 Session/
    Continuation 前通过 native owner 重新校验或幂等 prepare，禁止拿内存 `prepared` snapshot
    直接放行 Runtime launch。
26. Tauri debug resource 若也被 bundle resources copy 消费，staging destination 必须是与 source
    独立的 real tree，禁止 symlink。启动前验证 generated manifest 非空且合法；否则后续 copy
    可能把 source/destination 解析为同一文件并截断 runtime resource。
27. Model catalog entitlement、protocol endpoint smoke 与真实 CLI compatibility 必须分层取证。
    `/v1/models` 有 id 或 minimal curl 200 不能证明 Codex/Claude/Kimi 的真实 Agent payload
    （system/tools/stream/client headers）可完成；engine×model compatibility 只能由 exact Runtime
    target + typed terminal 证明，失败不得被 UI label、dispatch ACK 或另一 client identity 覆盖。
28. display/catalog/runtime identity 分域后，必须逐层审计 picker local state、per-thread persistence、
    AppShell effective-model repair、command payload 与 CLI launch config。UI label/勾选正确不能证明 runtime
    model 生效；至少用 exact per-thread selection + launch config alias + CLI request log 三点对账，禁止任一
    local/global catalog fallback 把 callable runtime 静默修回默认 model。
29. Runtime live wire 与 persisted transcript 可能不是同一 schema。修复 terminal/recovery 时必须同时抓取
    raw stdout event 与落盘 history：字段可能从 snake_case 变 camelCase、补充 status 或把 Provider error
    包成 synthetic assistant。Adapter MUST 在 live boundary 归一 authoritative rejection 并立即 settle；
    history scanner 只负责 recovery evidence，不能替代前台终态。process exit/EOF 仍只属于 cleanup。
30. 异步 mutation 创建新 Session/Entity 后若立即导航，必须先以 exact target identity 完成 destination state hydration，再选择目标。禁止先导航再 fire-and-forget 补写，也禁止用仍绑定 source active owner 的 setter 写 target；catalog/reducer dispatch 完成不等于 React closure 已看到新 row。
31. feature dependency boundary gate 报新增 edge 时，先按 ownership 分类再修：多 feature 共享的 pure/runtime/presentation capability 迁到 canonical neutral owner；peer UI integration 由更高层 host callback/slot 组合；确属 feature-owned 的稳定能力只走 public index。禁止用 re-export shim 隐藏 peer dependency，也禁止把新 edge 加入 exact debt baseline。owner move 后必须同时迁移 tests/mocks/import-type、收缩 stale baseline，并枚举所有 production entry，避免主入口修好但嵌套入口丢能力。
32. Native mutation 的成功 response 是 mutation boundary 的 authority。若切换命令本身已经完成状态写入，禁止用紧随其后的单次 read-back 否决成功结果；read-back 只用于 mutation 前发现 stale state，除非 runtime 明确提供了带版本/operation identity 的一致性确认。
33. Session creation/continuation 的 engine activation gate 必须按 engine registry 的
    `executionModel` 与 provider runtime contract 分流：persistent engine（当前 Codex）及
    managed Codex/Claude 必须在 session side effect 前确认 activation；Kimi 等 one-shot engine
    通过显式 `engine/providerProfileId` 路由每个 turn，不能把 global active-engine read-back 或
    `switch_engine` 失败误报为 one-shot session 创建/续接失败。共享 helper 必须同时返回
    activation options 与是否必须 fail closed，禁止各 caller 自行猜测。
34. External installer/config/remote-create mutation 的 side effect 与 response settlement 必须分域。Promise reject、IPC 丢失、malformed success 或首个 status snapshot stale 不能证明 mutation 未发生；先用 bounded authoritative convergence（binary/version/file/deterministic remote identity）判真，再映射 failure。若 remote create 有稳定 business identity，reconcile 必须在 Native/service owner 内 authoritative re-list + exact match + secure handoff，禁止把“再点一次 Retry 才看见已提交副作用”设计成 UI recovery。后续 remote prepare 必须切换 UI stage owner，避免把 Authority failure 继续归因到最后一个 local engine。自动 retry 只允许幂等 mutation、bounded budget、cooldown aware，并受 exact generation guard 约束。
35. Protocol compatibility 必须细化到产生 side effect 的 exact endpoint。`OpenAI-compatible`
    family 不能替代 `Responses` / `Chat Completions`，`/v1/models` row 也不能替代 endpoint
    callable evidence。跨 engine 共享 model 前，先列 `engine -> endpoint protocol` matrix，再用
    explicit upstream metadata 或 exact endpoint/CLI terminal 证明；缺证据按 endpoint fail closed。
36. Cold-start repair mutation 必须等 authoritative hydration 完成。`null` / partial / loading
    不能先经过 catalog/default resolver 再被当成“旧值修复”持久化；generation guard 只保护
    已有 mutation 的写序，不能证明 mutation 来源合法。双存储并存时必须显式定义 read
    authority，并保证 read path 不反向写回。
37. Provider-private artifact 可能只存在 persisted rollout，不出现在 app-server realtime wire。
    Shared terminal commit 必须用 frozen Provider/native session/runtime Turn identity exact reconcile，
    不能扫“最后一张图”或信 assistant prose。大 payload 先 bounded、content-addressed 落盘，canonical
    只存 compact ref；already-open UI 在 durable commit 后主动 refresh projection。若 locator 位于 App
    Data，媒体读取只 allowlist exact managed subtree，禁止为修破图放开整个 filesystem。

## 常见失败模式

- 前端字段名改了，service mapping 没更新。
- optional 字段被当 required 使用。
- `undefined` 与显式空集合（如 `[]`）被错误地当成同一语义，导致 fallback 误吃全量数据。
- retry 流程非 idempotent，触发重复副作用。
- installer 已落下 package/bin，但 response reject 被直接映射 `serviceUnavailable`；用户手工 retry 后成功，形成一次不必要的 terminal error。或 toolchain 已完成后 UI 仍显示最后一个 engine name，把 remote prepare failure 误报为本地安装失败。
- remote create 已提交 deterministic entity，但 response decode/validation 返回 `protocolMismatch`；UI 先展示 terminal error，用户 Retry 后 list 命中刚创建的 entity 并成功。正确 owner 应在首次 mutation 内完成 authoritative reconcile。
- 只隐藏主 UI，却遗漏 Prompt Enhancer、Project Map、Task Center recovery 或 legacy config replay 等 sibling execution surface。
- disabled/stale guard 放在 local/success 分支，remote forwarding、timeout/error fallback 仍先产生副作用。
- retry budget 放在 selection caller，其他 caller 再次调用 shared resume 时预算被隐式重置。
- 把 disabled provider 的 enabled background job 直接归一到另一个 provider，造成用户未确认的跨 provider 执行。
- listener 未清理，导致重复触发。
- 只监听 main WebView 的 drag/drop，遗漏 Browser Agent child WebView 截获的 OS drop，导致 Composer 外部文件拖入断链。
- 逐 delta externalization 后沿用旧 `seenDelta` completion guard，导致 reducer/snapshot 只保留首个 delta；history canonical overlay 再把完整 Legacy body降级成短前缀。
- 四级 Picker 看似已切换，但 actual-send 仍调用接受 flat
  `engine/model/providerProfileId` 的 legacy command。
- command 同时接收 `attemptId` 和 Target；caller 传的 Target 覆盖或旁路 durable
  Snapshot。
- `prepare_context(target)` 在 preview 阶段偷偷创建 Binding/推进 Cursor，导致用户只
  打开菜单或确认降级就产生 side effect。
- 新 Shared Session 只保存 Engine，首次发送前靠 global fallback 补 Model/Provider。
- Picker 先改 store 后持久化，写盘失败只 toast，不恢复旧 Target。
- early terminal 虽被缓存，但 bind 后 replay 与 live emit 之间没有 barrier，顺序仍然
  反转或 terminal 丢失。
- Rebuild 接受 caller 的 Engine/Provider，借恢复操作改写 durable Binding identity。
- 按 CLI 名称推断 terminal timing：Codex 等 event、Claude 强制 inline terminal，导致
  Claude 已正常回复却被前端提前标记为 ambiguous/recovery，真实 terminal 随后无人收口。
- 把 frontend terminal listener 当作 send completion owner：SQL 已存在
  `conversation.turnCommitted`，但 event 在 Tauri/WebView 边界丢失后 Composer 永久
  `running`，Stop 也只能处理 UI residue。
- terminal ledger 已正确写入，却被普通 React rerender 触发的 effect cleanup 清空；
  后续迟到 assistant/reasoning/item event 再次把已 commit Turn 标成 processing。
- 只移除 frontend/Tauri await 的 30 分钟 timeout，却遗漏 upstream Provider event
  forwarder 的同类 deadline；waiter 永远收不到真实 terminal。
- `Probe(active)` 只恢复 UI enum，没有恢复 exact owner、frozen Target 与 terminal
  observer；界面显示 running，实际无人负责 durable 收口。
- settlement 用 `notify_one`，旧 observer 与 reattachment 同时等待时只有一个被唤醒，
  另一个成为永久 pending ghost waiter。
- 旧 reattachment 晚到后无条件 `endTurn(threadId)`，把已经开始的新 Attempt owner 与
  frozen Target 一并清空。
- context package 已成功生成，仅 fidelity 降级，却弹出 Continue/Cancel 并阻塞发送；
  Target 切换因此退化成重复审批。
- 只在支付恢复页加入“退出登录”，套餐为空或服务失败时仍无账号切换入口；leaf tests
  全绿但完整 state machine 仍存在 dead end。
- stale generation 分支直接 `return`，忘记释放该 request 设置的 `loading=true`；或旧
  request 在 settle 时无 owner compare 地清 loading，造成新 request 的 spinner 被误清。
- 把 `target.engine === selectedEngine` 当成 managed access 已就绪；同 engine 从本地渠道切到
  托管渠道时绕过 native prepare，直到 CLI launch 才发现 OS vault secret 缺失并向用户暴露
  raw `credential is unavailable`。
- 只修 transcript scanner 的 camelCase API rejection，遗漏 live stdout 的 snake_case flag；DB 已写
  `target-provider-rejected`，但调用方仍卡在等待 EOF，形成“离线事实正确、前台永远 running”的分裂。
- boundary CI 红时只更新 allowlist/baseline，或新建 neutral re-export 文件继续 import peer owner；图表变绿但 ownership drift 被永久合法化。另一种常见遗漏是只给 main Layout 注入 peer slot，嵌套 Messages/Canvas entry 因没有 host composition 静默丢功能。
- 把 Responses 与 Chat Completions 合并成 broad `openai`，route capability 变化后仍靠 model
  名称猜可见性；结果既可能让真实 Codex turn 暴露 Composite 400，也可能在 route 已修复后继续
  隐藏本可调用的 K3/Kimi row。
- Shared backend 已有 valid image `ArtifactRef`，但 committed UI 只清 processing 不 refresh canonical
  projection，导致用户必须重开；或图片已落 App Data，却因 preview allowlist 未包含 exact managed
  subtree 显示破图。相反，直接 allow whole App Data 会把 presentation bug 变成 filesystem exposure。

## Optional Payload Contract

- 对 optional collection payload 必须显式区分三种状态：
  - `undefined` / `None`：调用方未提供 scope，允许 backend 使用既有 fallback。
  - `[]` / `Some([])`：调用方显式清空 scope，backend MUST 保持空结果，禁止回退到全量 diff。
  - `["a", "b"]` / `Some([...])`：调用方提供显式 scope，backend MUST 只处理该集合。
- 如果 UI 有“默认选中”与“用户手动清空后为空”两种空态，hook/service 层必须保留这个差异，不能只看当前集合内容。
- 涉及 path scope 的 payload，frontend 与 backend 必须共享 normalize contract，至少统一 `\\` / `/`、leading slash 与 trailing slash 处理。

## 最低验证集（Minimum Verification）

- `src/services/tauri.test.ts` payload mapping 测试。
- 对应 feature hook/component 的 error + edge case 测试。
- 至少覆盖一次“显式空 scope 不回退”的 UI + backend 回归测试。
- capability hard-disable 至少覆盖：fresh/legacy settings、visible selector、legacy replay、background detection/preflight、direct service/IPC、local/remote、sync/async。
- async owner 至少覆盖：success、error、unavailable、timeout、cache hit，以及 old-id/new canonical-id 或 workspace/thread scope race。
- streaming durability 至少覆盖：delta 可见、terminal full text 同 identity settle、snapshot 保存完整正文、dual-read 短前缀不覆盖长正文。
- Target/Runtime 至少覆盖：new、reload、Provider A → B → A、`catalog id != runtime
  model`、poisoned flat fields、Provider/Model rejection。
- attempt-owned lifecycle 至少覆盖：preflight 零副作用、Tx1 durable-first、
  dispatch attempt-only、early/live replay order、duplicate terminal、cancel intent、
  interrupt failure、rebuild derived owner。
- engine-neutral terminal 至少覆盖：每个 Shared CLI 的 accepted-only ACK、inline
  terminal fast path、late typed terminal、duplicate terminal、frontend terminal event
  完全缺失但 SQL 已 commit；断言所有 CLI 都走同一 Attempt durable await 与 settle
  逻辑，不出现 engine-name branch。
- frontend durable terminal barrier 至少覆盖：barrier 安装早于 processing cleanup、
  普通 rerender 不清 ledger、同 Turn 的 normalized/raw/reasoning 迟到事件不复燃、
  下一 Turn identity-only start 能解除旧 fallback 且不提前点亮 processing。
- long-running recovery 至少覆盖：exact waiter 超过外部 observation window 仍 pending、
  原 observer + reattach observer 都被 terminal/removal 唤醒、desktop/daemon event
  forwarder 均无 full-Turn deadline、restart 在 reattach 前保持 recovery lock、
  observer detach 保留 processing/owner/Target、晚到 commit 回 idle。
- degraded context 至少覆盖：preview/actual package 均可直发、diagnostic/manifest
  仍持久化、真正 prepare/ACK/rejection 失败仍 fail closed，且 UI 不进入确认 gate。
- 历史/Projection 至少覆盖：rich terminal blocks、failed/cancelled、
  reasoning/tool-only provenance、legacy dual-read、strict prompt echo filter。
- mandatory gate escape 至少覆盖：authenticated loading、selection、empty、failure、
  checkout 与 preparing 共享同一可见 action；pending 时阻止重复提交，失败后留在原
  state，成功后 stale catalog/checkout completion 不得重新推进旧流程。
- async loading ownership 至少覆盖：old request stale settle 不清 new owner；显式
  signed-out commit 取消旧 owner 后立即离开 loading；迟到旧 response 不恢复旧 session。
- managed Provider transition 至少覆盖：同 engine local/manual → managed、renderer
  `prepared` stale 但 native credential 缺失、prepare 失败时零 Session/Continuation side
  effect、prepare ready 后才建立新的 durable Provider binding。
- installer/prepare convergence 至少覆盖：side effect success + response reject、首个 post-install snapshot stale、bounded attempts exhausted、remote idempotent retry success/continuous failure、server cooldown、generation stale；真实 smoke 必须观察可执行 binary、managed config 与 AppShell mount，不能只信 mock RPC。
- runtime error parity 至少覆盖：同一 Provider rejection 的 live wire 与 persisted history 两种 fixture、
  camel/snake field 兼容、error result fallback、stdout 持有不退出；断言 exactly-one terminal、
  no completed、exact process owner 释放、UI caller Promise bounded settlement。
- mocked RPC 只能证明 mapping，不能代替 fake Runtime side-effect assertion。关键
  routing change 至少留一个可观察实际 Provider process/session key 与 Runtime model 的
  focused test。
- feature boundary 修复至少覆盖：旧 private/peer path 在 `src/**` 零命中、关键 singleton 只有一个定义、所有 production entry 都传完整 host integration、repository checker 显示 `inbound=0/new=0` 且 exact baseline 无 removed residue。
- contract 相关命令：

```bash
npm run check:runtime-contracts
npm run doctor:strict
```

## PR 记录要求

- 标注 cross-layer 影响面。
- 标注关键 mapping 变更点。
- 标注验证结果与剩余风险。
