# Design: Messages neutral ownership and host composition

## 1. Current failure graph

```text
outside feature ──deep import──> messages/private          (14)
messages          ──direct─────> peer feature              (19 new production/test edges)
messages tests    ──state drive─> unrelated peer store      (2 test edges)
```

`scripts/check-messages-boundaries.mjs` 对 inbound structural violation 永远 fail；outbound 只有 50 条 archive-time exact debt baseline。当前 `new=35` 不能通过 CI。

## 2. Ownership decisions

| Capability | Target owner | Decision |
|---|---|---|
| live assistant text channel、render scheduling flags、history loading progress | `src/conversation-presentation/**` | conversation-wide runtime/presentation contract，不能由 Threads private owner 垄断 |
| Agent task notification parser | `src/contracts/**` | pure wire/presentation contract，多 feature 共同消费 |
| task-run navigation event | `src/services/**` | application event bridge，Tasks 与 Messages 都是 consumer |
| file render profile / file tree icon resolver | `src/utils/**` | cross-feature pure file presentation primitive |
| multi-agent canvas item identity/filter | `src/conversation-presentation/**` | 主幕 presentation policy，供 Messages、Threads、Multi-Agent 共用 |
| Shared canonical projection | `src/features/shared-session/presentation/**` | Shared Session owns canonical projection；Messages only consumes already-projected items |
| Prompt Distill dialog/hook | Layout host composition | Messages emits `onSaveAsPrompt`; Layout owns peer feature hook/dialog |
| Multi-Agent history fold UI | Timeline render slot | Messages recognizes neutral item identity and asks host to render peer-owned card |
| turn file change public surface / collapsed timeline resolver | `messages/index.ts` | stable Messages-owned public API；external callers禁止 deep import |

## 3. Target graph

```text
Layout host ──composes──> Messages + Prompt Distill + Multi-Agent fold
features    ──consume───> neutral contracts/services/utils
outside     ──public────> messages/index.ts
Messages    ──internal──> messages private modules
```

Required terminal state：`inbound=0`、`new=0`。Outbound exact baseline MAY shrink when a neutral owner repays historical debt；it MUST NOT expand。

## 4. Behavior-preserving contracts

- `liveAssistantTextChannel` accumulated/published split、48ms cadence、terminal drain 与 rename semantics MUST remain byte-for-byte behavior compatible；only module ownership/import paths change。
- Prompt Distill fallback MUST remain available whenever no explicit `onSaveAsPrompt` override is supplied；dialog lifecycle and workspace scope remain unchanged。
- History Fold row MUST stay at the same timeline anchor and receive exact `workspaceId + threadId + itemId`；slot absence safely renders nothing。
- Shared projection continues canonical default-on + legacy dual-read；Rust remains lifecycle authority。
- Test cleanup MUST only remove coupling that never influenced the component under test；canonical immutable target badge assertions remain intact。

## 5. Error / validation matrix

| Case | Expected | Forbidden |
|---|---|---|
| external needs Messages capability | import from `messages/index.ts` | private path deep import |
| Messages needs generic runtime/presentation primitive | import neutral owner | new peer feature edge or re-export shim that hides peer ownership |
| Prompt Distill starts from message context menu | Layout-owned hook opens same dialog | Messages imports `prompt-distill/**` |
| History Fold id appears in timeline | host slot renders peer-owned card | Timeline imports `multi-agent/components/**` |
| exact baseline entry is repaid | remove it from baseline | keep stale exception or add new exception |
| shared projection load fails | existing legacy fallback remains | Messages reads Native history or invents target facts |

## 6. Tests

- `src/contracts/checkMessagesBoundaries.test.ts` + repository `npm run check:messages-boundaries`。
- live-text cadence/channel、realtime flags、render scheduling、history loading focused tests。
- Messages immutable target badge、timeline projection/fold slot、Prompt Distill host composition focused tests。
- Shared history loader/projection focused tests。
- target ESLint、typecheck、runtime contracts、large-file/heavy-test-noise、strict OpenSpec 与 diff check。

## 7. Risks

- 批量 import migration 可能遗漏 mock/import-type path；AST checker + typecheck 双重覆盖。
- host callback identity 可能击穿 Messages hot path memo；slot/callback 使用 stable `useCallback`，不读取每-delta text。
- module move 可能让 test reset 指向不同 singleton；所有 producer/consumer/test 必须同时迁移到唯一 neutral owner，不保留双实例 compatibility copy。
