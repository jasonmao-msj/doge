// legacy CLI 前台可见性的模块级外部 store。
//
// 事实源是 normalized AppSettings.disabledCliEngines；product-managed
// Claude/Codex/Kimi 已在 Rust/TypeScript settings boundary 被移出黑名单。
// 若沿 providerAvailability 的路径做 prop drilling,需要穿透 Composer →
// ChatInputBoxAdapter → ChatInputBox → Footer → ButtonArea 五层;改为与
// composerEnginePrefsStore 同构的外部 store 后,只有订阅可见性的 ProviderSelect
// 会重渲染。seed 由 useAppShellComposerPrefsPersistence 在设置变化时调用。

import { useSyncExternalStore } from "react";

let disabledIds: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadonlySet<string> {
  return disabledIds;
}

/** 命令式读取,供 effect / 事件回调使用(不订阅、不触发重渲染)。 */
export function getDisabledCliEngineIdsSnapshot(): ReadonlySet<string> {
  return disabledIds;
}

/** 设置加载完成及此后每次 disabledCliEngines 变化时调用;内容相同则不通知。 */
export function seedCliEngineVisibility(ids: readonly string[] | undefined): void {
  const next = new Set(ids ?? []);
  if (
    next.size === disabledIds.size &&
    [...next].every((id) => disabledIds.has(id))
  ) {
    return;
  }
  disabledIds = next;
  notify();
}

/** 订阅被停用的 CLI engine id 集合;默认空集 = 全部可见。 */
export function useCliEngineVisibility(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
