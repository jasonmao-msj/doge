/**
 * 幕布跟随 —— jetbrains 三 ref + 在底一直跟，并针对「MD 开渲狂闪 / 中途丢底」加固：
 *
 * 1. wheel 上滚才硬停；scroll 假离底保护（高度暴涨且 scrollTop 未上移 → 不解绑）
 * 2. 钉底后 isAutoScrolling 罩 2 帧，挡住 MD reflow 的 scroll 回声误杀
 * 3. ResizeObserver / live text：rAF 合并每帧最多钉一次（消狂闪）
 * 4. followSignal useLayoutEffect：同步钉底（同帧 layout，消 deferred 类一闪）
 * 5. 无 FORCE 超时松手
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
} from "react";
import { subscribeLiveAssistantText } from "@/conversation-presentation/liveAssistantTextChannel";

/** 距底阈值(px)。与 jetbrains BOTTOM_THRESHOLD_PX=100 一致。 */
export const CANVAS_BOTTOM_THRESHOLD_PX = 100;

const SCROLL_ANCHOR_ENABLED_CLASS = "scroll-anchor-enabled";

export function isCanvasNearBottom(
  container: Pick<HTMLDivElement, "scrollHeight" | "scrollTop" | "clientHeight">,
): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <
    CANVAS_BOTTOM_THRESHOLD_PX
  );
}

type UseMessagesCanvasFollowInput = {
  followSignal: unknown;
  isThinking: boolean;
  hasPendingJump?: boolean;
  /**
   * 产品「焦点跟随」：仅卡住 continuous stick（layout/RO/channel）。
   * 发送 / history-open / ScrollControl 的 resumeFollowAndPin 不受影响。
   */
  liveAutoFollowEnabledRef: MutableRefObject<boolean>;
  renderScopeKey: string;
  threadId: string | null;
};

export function useMessagesCanvasFollow({
  followSignal,
  isThinking,
  hasPendingJump = false,
  liveAutoFollowEnabledRef,
  renderScopeKey,
  threadId,
}: UseMessagesCanvasFollowInput) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isUserAtBottomRef = useRef(true);
  const isAutoScrollingRef = useRef(false);
  const userPausedRef = useRef(false);
  const pinRafRef = useRef<number | null>(null);
  const wheelRafRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const autoScrollClearRafRef = useRef<number | null>(null);
  /** 用户主动「回底」smooth 动画代数；递增可取消未完成的 finish 回调。 */
  const smoothPinTokenRef = useRef(0);
  const smoothPinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 假离底保护：区分「用户上滚」与「MD/工具高度暴涨」。
  const lastScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);

  const syncScrollAnchoring = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const shouldEnable = userPausedRef.current || !isUserAtBottomRef.current;
    container.classList.toggle(SCROLL_ANCHOR_ENABLED_CLASS, shouldEnable);
  }, []);

  /**
   * scroll 信道：真底 re-arm；仅 scrollTop 上移且高度未缩时释放。
   * 高度暴涨（MD 开渲）导致 distance>100 但 scrollTop 未动 → 保持武装。
   */
  const syncUserAtBottomState = useCallback(
    (container: HTMLDivElement) => {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const nearBottom = isCanvasNearBottom(container);

      if (nearBottom) {
        isUserAtBottomRef.current = true;
      } else {
        const heightShrank = scrollHeight < lastScrollHeightRef.current - 1;
        const scrollTopMovedUp = lastScrollTopRef.current - scrollTop >= 1;
        if (scrollTopMovedUp && !heightShrank) {
          isUserAtBottomRef.current = false;
        }
        // 否则保持原 isUserAtBottom（内容长高假离底不杀锁）
      }

      lastScrollTopRef.current = scrollTop;
      lastScrollHeightRef.current = scrollHeight;
      syncScrollAnchoring();
    },
    [syncScrollAnchoring],
  );

  const pauseFollow = useCallback(() => {
    userPausedRef.current = true;
    isUserAtBottomRef.current = false;
    syncScrollAnchoring();
  }, [syncScrollAnchoring]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    isAutoScrollingRef.current = true;
    isUserAtBottomRef.current = true;
    container.classList.remove(SCROLL_ANCHOR_ENABLED_CLASS);

    void container.scrollHeight;
    const endElement = messagesEndRef.current;
    if (endElement) {
      void endElement.offsetTop;
    }

    container.scrollTop = container.scrollHeight;
    lastScrollTopRef.current = container.scrollTop;
    lastScrollHeightRef.current = container.scrollHeight;

    if (autoScrollClearRafRef.current !== null) {
      cancelAnimationFrame(autoScrollClearRafRef.current);
    }
    // 两帧 grace：MD reflow 的 scroll 回声常落在写底后 1～2 帧，避免误杀 armed。
    autoScrollClearRafRef.current = requestAnimationFrame(() => {
      autoScrollClearRafRef.current = requestAnimationFrame(() => {
        autoScrollClearRafRef.current = null;
        isAutoScrollingRef.current = false;
      });
    });
  }, []);

  /**
   * continuous stick：每帧最多钉一次（rAF 合并）。
   * RO / live text 高频连打时只落一次，消「MD 开渲狂闪」。
   */
  const pinIfFollowing = useCallback(() => {
    if (!containerRef.current) {
      return;
    }
    if (!liveAutoFollowEnabledRef.current) {
      return;
    }
    // smooth 回底动画期间不要瞬时改写 scrollTop，否则会掐掉过渡。
    if (isAutoScrollingRef.current) {
      return;
    }
    if (userPausedRef.current || !isUserAtBottomRef.current) {
      return;
    }
    if (pinRafRef.current !== null) {
      return;
    }
    pinRafRef.current = requestAnimationFrame(() => {
      pinRafRef.current = null;
      if (
        !liveAutoFollowEnabledRef.current ||
        userPausedRef.current ||
        !isUserAtBottomRef.current ||
        isAutoScrollingRef.current
      ) {
        return;
      }
      scrollToBottom();
    });
  }, [liveAutoFollowEnabledRef, scrollToBottom]);

  const clearSmoothPinTimer = useCallback(() => {
    if (smoothPinTimeoutRef.current !== null) {
      clearTimeout(smoothPinTimeoutRef.current);
      smoothPinTimeoutRef.current = null;
    }
  }, []);

  const resumeFollowAndPin = useCallback(() => {
    // 发送 / history-open 等强制瞬时钉底：取消进行中的 smooth，避免打架。
    smoothPinTokenRef.current += 1;
    clearSmoothPinTimer();
    userPausedRef.current = false;
    isUserAtBottomRef.current = true;
    scrollToBottom();
    requestAnimationFrame(() => {
      if (!userPausedRef.current) {
        scrollToBottom();
      }
    });
    syncScrollAnchoring();
  }, [clearSmoothPinTimer, scrollToBottom, syncScrollAnchoring]);

  /**
   * 用户主动「回到底部」：与回顶对称的 smooth 动画，结束后再硬钉一次
   * 以吃掉动画途中内容长高。send / turn-settle 仍走 resumeFollowAndPin 瞬时通道。
   */
  const resumeFollowAndSmoothPin = useCallback(() => {
    const container = containerRef.current;
    userPausedRef.current = false;
    isUserAtBottomRef.current = true;
    syncScrollAnchoring();

    if (!container) {
      return;
    }

    container.classList.remove(SCROLL_ANCHOR_ENABLED_CLASS);

    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const distance = maxTop - container.scrollTop;
    // 已在底附近：无动画空间，直接瞬时钉（与 resumeFollowAndPin 一致）。
    if (distance <= 4) {
      scrollToBottom();
      return;
    }

    clearSmoothPinTimer();
    const token = ++smoothPinTokenRef.current;

    // 罩住整段 smooth，避免 scroll 回声 / RO 中途瞬时 pin 掐动画。
    isAutoScrollingRef.current = true;
    if (autoScrollClearRafRef.current !== null) {
      cancelAnimationFrame(autoScrollClearRafRef.current);
      autoScrollClearRafRef.current = null;
    }

    container.scrollTo({ top: maxTop, behavior: "smooth" });

    let settled = false;
    const finish = () => {
      if (settled || token !== smoothPinTokenRef.current) {
        return;
      }
      settled = true;
      clearSmoothPinTimer();
      container.removeEventListener("scrollend", finish);
      if (userPausedRef.current) {
        isAutoScrollingRef.current = false;
        return;
      }
      // 终态硬钉：对齐动画途中可能的高度增长，并打开 continuous stick。
      scrollToBottom();
    };

    container.addEventListener("scrollend", finish, { once: true });
    // scrollend 在部分环境不可用（旧 WebKit / jsdom）；按距离给兜底超时。
    const timeoutMs = Math.min(1000, Math.max(350, Math.round(distance * 0.55)));
    smoothPinTimeoutRef.current = setTimeout(finish, timeoutMs);
  }, [clearSmoothPinTimer, scrollToBottom, syncScrollAnchoring]);

  const settleFollow = useCallback(() => {
    if (userPausedRef.current) {
      return;
    }
    resumeFollowAndPin();
  }, [resumeFollowAndPin]);

  useLayoutEffect(() => {
    if (hasPendingJump) {
      userPausedRef.current = true;
      isUserAtBottomRef.current = false;
    } else {
      userPausedRef.current = false;
      isUserAtBottomRef.current = true;
    }
    isAutoScrollingRef.current = false;
    lastScrollTopRef.current = 0;
    lastScrollHeightRef.current = 0;
    if (pinRafRef.current !== null) {
      cancelAnimationFrame(pinRafRef.current);
      pinRafRef.current = null;
    }
    if (autoScrollClearRafRef.current !== null) {
      cancelAnimationFrame(autoScrollClearRafRef.current);
      autoScrollClearRafRef.current = null;
    }
    smoothPinTokenRef.current += 1;
    if (smoothPinTimeoutRef.current !== null) {
      clearTimeout(smoothPinTimeoutRef.current);
      smoothPinTimeoutRef.current = null;
    }
  }, [hasPendingJump, renderScopeKey]);

  // layout 同步钉底（paint 前）；与 jetbrains 一致，避免内容先 paint 再 rAF 钉。
  useLayoutEffect(() => {
    void followSignal;
    void isThinking;
    syncScrollAnchoring();
    if (!liveAutoFollowEnabledRef.current) {
      return;
    }
    if (userPausedRef.current || !isUserAtBottomRef.current) {
      return;
    }
    scrollToBottom();
  }, [
    followSignal,
    isThinking,
    liveAutoFollowEnabledRef,
    scrollToBottom,
    syncScrollAnchoring,
  ]);

  useEffect(() => {
    if (!threadId || !isThinking) {
      return undefined;
    }
    return subscribeLiveAssistantText(threadId, () => {
      pinIfFollowing();
    });
  }, [isThinking, pinIfFollowing, threadId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    lastScrollTopRef.current = container.scrollTop;
    lastScrollHeightRef.current = container.scrollHeight;
    syncScrollAnchoring();

    const handleScroll = () => {
      if (scrollRafRef.current !== null) {
        return;
      }
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        if (isAutoScrollingRef.current) {
          lastScrollTopRef.current = container.scrollTop;
          lastScrollHeightRef.current = container.scrollHeight;
          return;
        }
        if (userPausedRef.current) {
          lastScrollTopRef.current = container.scrollTop;
          lastScrollHeightRef.current = container.scrollHeight;
          return;
        }
        syncUserAtBottomState(container);
      });
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        userPausedRef.current = true;
        isUserAtBottomRef.current = false;
        syncScrollAnchoring();
        return;
      }
      if (event.deltaY > 0) {
        if (wheelRafRef.current !== null) {
          cancelAnimationFrame(wheelRafRef.current);
        }
        wheelRafRef.current = requestAnimationFrame(() => {
          wheelRafRef.current = null;
          if (isCanvasNearBottom(container)) {
            userPausedRef.current = false;
            isUserAtBottomRef.current = true;
          }
          lastScrollTopRef.current = container.scrollTop;
          lastScrollHeightRef.current = container.scrollHeight;
          syncScrollAnchoring();
        });
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    container.addEventListener("wheel", handleWheel, { passive: true });

    const resolveObservedContent = (): HTMLElement | null => {
      const endParent = messagesEndRef.current?.parentElement;
      if (endParent instanceof HTMLElement && endParent !== container) {
        return endParent;
      }
      const timelineRoot = container.querySelector<HTMLElement>(".messages-timeline-root");
      if (timelineRoot) {
        return timelineRoot;
      }
      const first = container.firstElementChild;
      return first instanceof HTMLElement ? first : null;
    };

    if (typeof ResizeObserver === "undefined") {
      return () => {
        container.removeEventListener("scroll", handleScroll);
        container.removeEventListener("wheel", handleWheel);
        container.classList.remove(SCROLL_ANCHOR_ENABLED_CLASS);
      };
    }

    // RO：rAF 合并钉底，避免 MD 每 token reflow 同步狂写 scrollTop。
    const observer = new ResizeObserver(() => {
      if (userPausedRef.current) {
        syncScrollAnchoring();
        return;
      }
      if (!liveAutoFollowEnabledRef.current) {
        return;
      }
      if (isUserAtBottomRef.current) {
        pinIfFollowing();
        return;
      }
      syncUserAtBottomState(container);
    });

    observer.observe(container);
    const content = resolveObservedContent();
    if (content) {
      observer.observe(content);
    }

    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", handleWheel);
      container.classList.remove(SCROLL_ANCHOR_ENABLED_CLASS);
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      if (wheelRafRef.current !== null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
      if (pinRafRef.current !== null) {
        cancelAnimationFrame(pinRafRef.current);
        pinRafRef.current = null;
      }
      if (autoScrollClearRafRef.current !== null) {
        cancelAnimationFrame(autoScrollClearRafRef.current);
        autoScrollClearRafRef.current = null;
      }
      smoothPinTokenRef.current += 1;
      if (smoothPinTimeoutRef.current !== null) {
        clearTimeout(smoothPinTimeoutRef.current);
        smoothPinTimeoutRef.current = null;
      }
    };
  }, [
    liveAutoFollowEnabledRef,
    pinIfFollowing,
    renderScopeKey,
    scrollToBottom,
    syncScrollAnchoring,
    syncUserAtBottomState,
  ]);

  const getPendingScrollResourceCount = useCallback(
    () => (pinRafRef.current !== null ? 1 : 0),
    [],
  );

  return {
    containerRef,
    getPendingScrollResourceCount,
    isUserAtBottomRef,
    messagesEndRef,
    pauseFollow,
    pinIfFollowing,
    resumeFollowAndPin,
    resumeFollowAndSmoothPin,
    scrollToBottom,
    settleFollow,
    userPausedRef,
  };
}
