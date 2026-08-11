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

## 常见失败模式

- 前端字段名改了，service mapping 没更新。
- optional 字段被当 required 使用。
- `undefined` 与显式空集合（如 `[]`）被错误地当成同一语义，导致 fallback 误吃全量数据。
- retry 流程非 idempotent，触发重复副作用。
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
- mocked RPC 只能证明 mapping，不能代替 fake Runtime side-effect assertion。关键
  routing change 至少留一个可观察实际 Provider process/session key 与 Runtime model 的
  focused test。
- contract 相关命令：

```bash
npm run check:runtime-contracts
npm run doctor:strict
```

## PR 记录要求

- 标注 cross-layer 影响面。
- 标注关键 mapping 变更点。
- 标注验证结果与剩余风险。
