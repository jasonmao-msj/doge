import { useCallback, useSyncExternalStore } from "react";
import {
  getLiveAssistantTextSnapshot,
  subscribeLiveAssistantText,
  type LiveAssistantTextEntry,
} from "@/conversation-presentation/liveAssistantTextChannel";

const noopSubscribe = () => () => {};

/**
 * 订阅某线程的活跃流式正文（liveAssistantTextChannel）。
 * enabled=false 或 threadId 为空时订阅空 store、恒返回 null——满足 hook
 * 调用次序恒定的同时，未流式的行零订阅开销。
 * 快照引用由通道保证稳定（append 时才换新对象），符合 useSyncExternalStore
 * 对 getSnapshot 的一致性要求。
 */
export function useLiveAssistantText(
  threadId: string | null | undefined,
  enabled: boolean,
): LiveAssistantTextEntry | null {
  const active = Boolean(enabled && threadId);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active || !threadId) {
        return noopSubscribe();
      }
      return subscribeLiveAssistantText(threadId, listener);
    },
    [active, threadId],
  );
  const getSnapshot = useCallback(() => {
    if (!active || !threadId) {
      return null;
    }
    return getLiveAssistantTextSnapshot(threadId);
  }, [active, threadId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
