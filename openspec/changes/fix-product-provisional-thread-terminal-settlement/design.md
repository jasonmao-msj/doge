## Context

Product Home can hold a local logical thread whose id was minted before the selected Native engine/session identity is known. In the observed Kimi turn, the logical id was an unprefixed UUID while `engineSource=KIMI` and `activeTurnId=kimi-turn-*`. Backend emitted `SessionStarted(session_*)`, assistant text and `TurnCompleted` correctly. Frontend rejected promotion because both pending resolvers and `isPendingThreadForEngine` required `kimi-pending-*`; terminal then settled only `kimi:session_*`, leaving the selected UUID thread busy.

Constraints:

- `turn/completed` is authoritative; assistant text is not terminal evidence.
- Rebinding must be exact-turn scoped to avoid merging concurrent or established sessions.
- Session promotion and terminal can arrive within the same React render interval, so alias settlement cannot rely on a later rerender.

## Goals / Non-Goals

**Goals:**

- Promote an engine-tagged unprefixed provisional thread when its active turn exactly matches the session hint turn.
- Settle both canonical and provisional identities when terminal arrives immediately after promotion.
- Preserve current prefix-based pending behavior and concurrency guards.

**Non-Goals:**

- No timer/text heuristic settlement.
- No backend wire or persisted schema change.
- No generic rebinding from active selection alone.

## Decisions

### Exact turn ownership extends provisional recognition

`resolvePendingThreadIdForTurn` will consider either conventional pending aliases or non-canonical threads whose `engineSource` matches the requested engine. A candidate is returned only when its normalized `activeTurnId` equals the incoming turn id.

Alternative：treat every active unprefixed thread as pending. Rejected because active selection is not lifecycle ownership and can steal concurrent sessions.

### Resolver authority replaces prefix revalidation

`onThreadSessionIdUpdated` will accept a non-null exact turn-bound resolver result without rechecking the pending prefix. Prefix validation remains for workspace-level fallback candidates.

Alternative：add `01a*` as another pending prefix. Rejected because UUID shape does not encode engine or ownership.

### Same-tick terminal settles Kimi/Grok aliases

`resolvePendingAliasThread` will include canonical `kimi:` and `grok:` prefixes. It queries the exact turn resolver, allowing terminal handling to settle both canonical and provisional state even before React has rerendered after `renameThreadId`.

Alternative：delay terminal with `setTimeout` until rename renders. Rejected because it introduces timing dependency and can reorder critical terminal events.

## Risks / Trade-offs

- [Engine metadata is stale] → require exact active turn match; engine mismatch is excluded before candidate selection.
- [Canonical session already has history] → retain `newThreadIsEstablished` guard; do not promote onto an established target.
- [Terminal arrives after reducer rename] → duplicate settlement remains idempotent through existing reducer guards.
- [Other engines use unprefixed provisional ids] → generic exact-turn implementation supports them without adding business branches; focused regression covers Kimi evidence.

## Migration Plan

1. Ship frontend resolver/alias changes; no data migration.
2. Existing stuck UI clears on restart/history reload; new turns use corrected promotion.
3. Rollback is code-only because no persisted format changes.

## Open Questions

- None for implementation. A follow-up may normalize Product Home creation to conventional engine-prefixed pending ids, but correctness must not depend on that presentation choice.
