import type { CustomPromptOption } from "../../types";

type PromptCreationScope = "workspace" | "global";

export type PromptCreationRequest = {
  scope: PromptCreationScope;
};

export type CustomPromptsRefreshPhase = "idle-prewarm" | "on-demand";

export type CustomPromptsRefreshOptions = {
  /**
   * 当 hook 已对当前 workspace 完成权威成功 settle 时跳过 IPC，直接返回缓存。
   * 用于 `!` 空态 revalidate，避免真·空列表每次键入都打 prompts_list。
   */
  skipIfAuthoritative?: boolean;
};

export type CustomPromptsRefreshHandler = (
  workspaceId: string,
  phase?: CustomPromptsRefreshPhase,
  options?: CustomPromptsRefreshOptions,
) => Promise<CustomPromptOption[] | void>;

const CUSTOM_PROMPTS_CHANGED_EVENT = "doge:custom-prompts-changed";
const PROMPT_CREATION_REQUEST_EVENT = "doge:prompt-creation-request";

let pendingPromptCreationRequest: PromptCreationRequest | null = null;
const customPromptsRefreshHandlers = new Set<CustomPromptsRefreshHandler>();

export function dispatchCustomPromptsChanged(workspaceId: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(CUSTOM_PROMPTS_CHANGED_EVENT, {
      detail: { workspaceId },
    }),
  );
}

export function subscribeCustomPromptsChanged(
  listener: (workspaceId: string) => void,
) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleEvent = (event: Event) => {
    const workspaceId =
      (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId ?? null;
    if (workspaceId) {
      listener(workspaceId);
    }
  };

  window.addEventListener(CUSTOM_PROMPTS_CHANGED_EVENT, handleEvent);
  return () => {
    window.removeEventListener(CUSTOM_PROMPTS_CHANGED_EVENT, handleEvent);
  };
}

/**
 * 注册 prompts 列表 on-demand refresh 处理器。
 * `!` 空态 revalidate 等跨层调用方通过 requestCustomPromptsRefresh 触发，
 * 避免把 refresh 沿 app-shell → layout → Composer 全链路透传。
 */
export function subscribeCustomPromptsRefresh(handler: CustomPromptsRefreshHandler) {
  customPromptsRefreshHandlers.add(handler);
  return () => {
    customPromptsRefreshHandlers.delete(handler);
  };
}

/**
 * 请求当前 workspace 的 prompts 列表刷新，聚合所有已注册 hook 实例的结果。
 * 无 handler 时返回 []；有结果时优先返回最长列表（通常各实例结果一致）。
 */
export async function requestCustomPromptsRefresh(
  workspaceId: string,
  phase: CustomPromptsRefreshPhase = "on-demand",
  options?: CustomPromptsRefreshOptions,
): Promise<CustomPromptOption[]> {
  if (!workspaceId || customPromptsRefreshHandlers.size === 0) {
    return [];
  }
  const results = await Promise.all(
    [...customPromptsRefreshHandlers].map((handler) =>
      handler(workspaceId, phase, options),
    ),
  );
  let best: CustomPromptOption[] = [];
  for (const result of results) {
    if (Array.isArray(result) && result.length >= best.length) {
      best = result;
    }
  }
  return best;
}

export function requestPromptCreation(request: PromptCreationRequest) {
  pendingPromptCreationRequest = request;
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(PROMPT_CREATION_REQUEST_EVENT, {
      detail: request,
    }),
  );
}

export function consumePendingPromptCreationRequest() {
  const request = pendingPromptCreationRequest;
  pendingPromptCreationRequest = null;
  return request;
}

export function subscribePromptCreationRequests(
  listener: (request: PromptCreationRequest) => void,
) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleEvent = (event: Event) => {
    const request =
      (event as CustomEvent<PromptCreationRequest | undefined>).detail ?? null;
    if (request) {
      listener(request);
    }
  };

  window.addEventListener(PROMPT_CREATION_REQUEST_EVENT, handleEvent);
  return () => {
    window.removeEventListener(PROMPT_CREATION_REQUEST_EVENT, handleEvent);
  };
}
