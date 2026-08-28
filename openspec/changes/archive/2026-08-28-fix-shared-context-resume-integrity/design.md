## Context

### 二次复核结论（相对初版）

| 初版假设 | 代码事实 | 校正 |
|----------|----------|------|
| zero-transfer 一律是 bug | **健康路径有意如此**：destination-owned + accepted cursor 假设 native 已持有历史（单测 `destination_owned_only_package_has_no_transfer_payload`、`portable_context_excludes_destination_owned_history_on_a_b_a_reuse`） | 不能一律 rematerialize |
| 只靠 empty guard 即可 | Claude 同 Binding 第二次起常 **zero-transfer + 仅用户句**，正确性完全依赖 **native resume** | 必须管理「native 是否仍可信」 |
| 修全部图1 | 锁死已另案；幕布 projection 另径；Canonical 无原任务无法补 | 范围收敛为 **trust + 条件 rematerialize** |

### 健康路径（必须保留）

```text
T1: 无历史 → zero-transfer → 只发用户句 → accept → native 建立
T2: destination-owned 吞掉 T1 + accepted cursor → zero-transfer
    → 只发「继续」+ --resume native  → 正确
```

### 故障路径（必须修）

```text
T1…Tn 后 context/turn 已 accept，native id 仍在
→ 503 / provider-rejected / native-session-not-found / recovery
→ native 实际不可用或 transcript 与 Shared 脱节
→ 仍 trusted 假设 → T(n+1) zero-transfer 只发「继续」→ 模型无原任务
```

### 关键代码锚点

- `compiler.rs`：`destination_owned_attempts` 仅看 `conversation.turnAccepted` + bindingKey；有 `destination_native_session_id` 即省略。
- `dispatch`：`prompt_prefix` 空则 `outbound_text = user_text`；可标 `no-context-transfer-required`。
- Claude：`strong_context_ack` 时 checksum echo 后才 `accept_context`；其后 API 503 仍可能已 accept context。
- Binding 状态：`provisioning_json` 可扩展，无需新列。

## Goals / Non-Goals

**Goals:**

1. 用 **nativeContextTrust** 区分「可依赖 native 省略交接」与「必须从 Canonical 再投影」。
2. dirty 时 zero-transfer+needs-history → rematerialize。
3. trusted 时保持 no-replay / A-B-A。
4. dirty 信号覆盖图1 类失败，不依赖猜测 engine 名。

**Non-Goals:**

- 每轮全量 prefix。
- UI Shared history 幕布投影。
- 网关容量 / recovery 锁语义重做。

## Decisions

### D1. Trust 模型（替代「一律 rematerialize」）

```text
nativeContextTrust ∈ { trusted, dirty }
默认：新 binding / rebuild 后 → dirty（无可靠 native 历史假设）
成功 context accept（非 zero-transfer）或「zero-transfer 且本轮 completed 且 had resume」→ trusted
失败信号 → dirty
```

**落盘：** `provisioning_json.nativeContextTrust`（string）。缺省字段：

- **缺字段 → dirty（fail-closed）**；升级后首次发送 rematerialize 一次，accept/completed 写回 trusted
- 显式 `trusted` / `dirty` 按字面读取

> 2026-08-04 review 校准：否决 ready+native 缺省 trusted（会放过已坏 legacy 会话）。

### D2. 何时标 dirty（必须接线）

| 事件 | trust |
|------|--------|
| `target-provider-rejected` / OutcomeStatus::Failed（含 503 文案）terminal commit | dirty |
| `binding-recovery-required: native-session-not-found` | dirty |
| `mark_recovery` / provisioning recovery-required | dirty |
| `rebuild_binding` | native=None + dirty |
| `abandon` 后仍保留 native | dirty（安全偏向） |
| ambiguous dispatch 清理路径保留 native | dirty |

实现落点：优先 `commit_observed_runtime_settlement` / mark_recovery / rebuild / abandon 统一 `set_binding_native_context_trust`。

### D3. prepare_delivery 条件 rematerialize

```text
package = compile(from=accepted, dest_native=binding.native_id)
needs_history = full_compile_without_owned would be non-empty
trust = read_trust(binding)  // missing field → dirty

# P0 校准：不可仅看 zero-transfer。
# 失败轮「继续」未 turnAccepted 时增量 package 非空但缺原任务。
if trust == dirty && needs_history:
  package = compile(from=None, dest_native=None)  // rematerialize
  rematerialized = true
  if is_zero_transfer(package):
    return Err("empty-context-handoff: ...")  // 主前缀，勿被 context-prepare-failed 吞掉
elif trust == trusted:
  // 健康路径：允许 zero-transfer / destination-owned
  pass

write artifact + pending
return { rematerialized, nativeContextTrust: trust }
```

**不在 prepare 阶段清 accepted cursor**；rematerialize 只影响本 attempt package 身份。

**Checkpoint：** 预算裁剪 MUST 保留 earliest user（原任务），优先删中间轮再保 latest spine。

### D4. 何时清回 trusted

| 事件 | trust |
|------|--------|
| context accept 且本轮 package **非** zero-transfer（含 rematerialize 成功） | trusted |
| context accept 且 zero-transfer 且本轮最终 **completed** | trusted（native resume 被验证能干活） |
| context accept 且 zero-transfer 且本轮 **failed** | **保持 dirty** 或标 dirty |

### D5. destination-owned 不改 compiler 签名（最小）

rematerialize 时调用方传 `destination_native_session_id=None` 即可关闭 owned 省略（已有行为）。  
**不**在 compiler 内引入 trust 参数（保持纯函数）。

### D6. 与「accepted run failure does not replay」对齐

| 条件 | 行为 |
|------|------|
| trusted | 禁同 package 盲 replay；zero-transfer OK |
| dirty | 允许**新** packageId 全量 rematerialize（输入 from/dest 变 → id 变） |

### D7. 前端

- P0 可不改 FE（backend 自愈）。
- P1：映射 `empty-context-handoff:`；可选展示 rematerialized 提示。

### D8. 明确不修

- Shared 幕布 projection 缺条（`sharedHistoryLoader` / projector）。
- 用户从未在 Shared 里发过原任务（Canonical 无 `turnRequested` 正文）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 旧 binding 已坏但 compat 读 trusted | D2 覆盖新失败；可选：failed 后下一次 prepare 见「上轮 failed 且 zero-transfer」强制 dirty |
| rematerialize 超 budget | 既有 checkpoint；degraded confirmation 保留 |
| dirty 过宽导致频繁全量 | 仅失败路径标 dirty；completed 清 trusted |
| 双写 prefix + native 历史重复 | 可接受安全偏向；模型通常可处理 |
| 漏打 dirty | 验收矩阵列全信号；单测强制 |

## Migration Plan

1. 读写 `nativeContextTrust` 兼容缺省。
2. 接线 dirty/trusted + rematerialize + 测试。
3. 回滚：revert；旧客户端忽略未知 JSON 字段。
4. 已锁会话：先 recovery-exit 解锁，再发送触发 dirty 路径。

## Open Questions（已决议）

| Q | 决议 |
|---|------|
| 是否每轮 rematerialize？ | **否** |
| prepare 是否清 accepted？ | **否** |
| dirty 是否新表？ | **否**，provisioning_json |
| 是否保证修 UI 读不全？ | **否**，非目标 |

## Implementation Sketch

```text
fn set_trust(writer, session, binding_key, trust)
fn read_trust(binding) -> Trust

// on Failed / native-not-found / recovery / rebuild / abandon:
set_trust(..., Dirty)

// prepare_delivery:
if zero && needs_history && read_trust() == Dirty:
  package = rematerialize_compile(...)
  
// on DeliveryAccepted with non-zero package OR Completed after zero:
set_trust(..., Trusted)
```

## 文件触点

| 文件 | 变更 |
|------|------|
| `src-tauri/src/shared_session_v2.rs` | trust R/W、dirty 接线、prepare rematerialize |
| `src-tauri/src/shared_context/compiler.rs` 或 `mod.rs` | `is_zero_transfer` / `needs_history` helper（可测） |
| `src-tauri/tests/shared_context.rs` | dirty 续接、trusted 不强制、A-B-A 回归 |
| i18n（可选） | empty-context-handoff |
