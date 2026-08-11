/**
 * 协作 worker native thread id 前端 hide 注册表。
 *
 * 问题：Codex/Grok 等 worker 落盘后会被 catalog 改名成 `Agent N` / 模型正文标题，
 * 仅靠协议标题闸会漏；hide set 又依赖 shared list 的 nativeThreadIds materialize。
 *
 * 方案：worker realtime 一旦出现，立刻把 native id（含 engine 前缀变体）记入本表，
 * listThreads strip 时与 expandHiddenSharedBindingIds 结果求并集。
 */

import { expandHiddenSharedBindingIds } from "../../shared-session/runtime/sharedSessionSummaries";

const rawIds = new Set<string>();

/** 测试 / 会话切换时清空 */
export function clearCollabWorkerNativeHideIds(): void {
  rawIds.clear();
}

/**
 * 记录协作 worker 的 native thread id。
 * 接受 `codex:uuid` / 裸 uuid / `thread-xxx` 等形态。
 */
export function rememberCollabWorkerNativeThreadId(
  threadId: string | null | undefined,
): void {
  const id = typeof threadId === "string" ? threadId.trim() : "";
  if (!id) return;
  // agent-canvas: 是前端合成键，不是侧栏 native id
  if (id.startsWith("agent-canvas:")) return;
  if (id.startsWith("shared:")) return;
  rawIds.add(id);
}

/** 展开后的 hide id 集合（含 engine: 前缀变体） */
export function getCollabWorkerNativeHideIds(): Set<string> {
  if (rawIds.size === 0) return new Set();
  return expandHiddenSharedBindingIds(rawIds);
}

/** 是否命中协作 worker hide（供侧栏/恢复卡快速判断） */
export function isCollabWorkerNativeThreadId(
  threadId: string | null | undefined,
): boolean {
  const id = typeof threadId === "string" ? threadId.trim() : "";
  if (!id) return false;
  const expanded = getCollabWorkerNativeHideIds();
  if (expanded.has(id)) return true;
  const colon = id.indexOf(":");
  if (colon > 0) {
    const bare = id.slice(colon + 1).trim();
    if (bare && expanded.has(bare)) return true;
  }
  return false;
}

/** 测试探测 */
export function __debugCollabWorkerRawHideIds(): string[] {
  return Array.from(rawIds);
}
