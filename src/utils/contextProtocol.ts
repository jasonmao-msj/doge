import type { ConversationItem } from "../types";

const SHA256 = "sha256:[0-9a-f]{64}";
const PACKAGE_MARKER = new RegExp(
  `^(?:DOGE|MOSSX)_CONTEXT_PACKAGE:${SHA256}:${SHA256}$`,
);
const ACCEPTED_MARKER = new RegExp(
  `^(?:DOGE|MOSSX)_CONTEXT_ACCEPTED:${SHA256}:${SHA256}$`,
);
const NATIVE_CONTEXT_PROMPT = new RegExp(
  `^(?:DOGE|MOSSX)_CONTEXT_PACKAGE:${SHA256}:${SHA256}\\r?\\n` +
    "(?:DOGE|MOSSX)_NATIVE_CONTEXT_V1\\r?\\n" +
    "source:[^\\r\\n]+\\r?\\n" +
    "binding:[^\\r\\n]+(?:\\r?\\n|$)",
);
const SHARED_RUNTIME_PROMPT = new RegExp(
  `^((?:DOGE|MOSSX)_CONTEXT_PACKAGE:${SHA256}:${SHA256})\\r?\\n` +
    "(?:DOGE|MOSSX)_SHARED_CONTEXT_V1\\r?\\n" +
    "session:[^\\r\\n]+\\r?\\n" +
    "binding:[^\\r\\n]+\\r?\\n" +
    "[\\s\\S]*\\r?\\n\\1\\r?\\n" +
    "\\r?\\nCurrent user request:\\r?\\n[\\s\\S]+$",
);
const CODEX_ENVIRONMENT_CONTEXT =
  /^<environment_context>[\s\S]*<\/environment_context>$/;

export type ContextProtocolFilterOptions = {
  /**
   * 仅由 authoritative Codex Provider Continuation metadata 开启。
   * 隐藏 Codex app-server 在 doge/legacy control prompt 前后生成的 leading bootstrap。
   */
  hideLeadingContinuationBootstrap?: boolean;
};

export type ContextProtocolKind =
  | "context-package"
  | "context-accepted"
  | "native-context-prompt"
  | "shared-runtime-prompt";

/**
 * Runtime 注入的 control-plane protocol token（会成为 native 会话 firstMessage / 侧栏 title）。
 * 全量清单（与 compiler / shared_session_v2 / native_continuation 一致）：
 * - DOGE_CONTEXT_PACKAGE（兼容 MOSSX_CONTEXT_PACKAGE）
 * - DOGE_CONTEXT_ACCEPTED（兼容 MOSSX_CONTEXT_ACCEPTED）
 * - DOGE_NATIVE_CONTEXT_V1（兼容 MOSSX_NATIVE_CONTEXT_V1）
 * - DOGE_SHARED_CONTEXT_V1（兼容 MOSSX_SHARED_CONTEXT_V1）
 *
 * 非会话标题（勿当 hide 依据）：env / window / 测试 probe（MOSSX_WEB_*、MOSSX_S2_PROBE 等）
 * 不会以 `MOSSX_` 行首出现在用户可命名的侧栏 title；用户正文讨论这些词也不会行首。
 *
 * 侧栏 title 经 previewThreadName 截到 50 字后无法满足完整 sha256 正则，
 * 因此标题闸必须用行首 `MOSSX_` 前缀，不能只依赖 classifyContextProtocolText。
 */
export const DOGE_PROGRAM_CONTROL_TITLE_TOKENS = [
  "DOGE_CONTEXT_PACKAGE",
  "DOGE_CONTEXT_ACCEPTED",
  "DOGE_NATIVE_CONTEXT_V1",
  "DOGE_SHARED_CONTEXT_V1",
  "MOSSX_CONTEXT_PACKAGE",
  "MOSSX_CONTEXT_ACCEPTED",
  "MOSSX_NATIVE_CONTEXT_V1",
  "MOSSX_SHARED_CONTEXT_V1",
] as const;

/** 行首程序生成 control-plane 标题（含截断后的 `MOSSX_CONTEXT_PACKAGE:sha25…`）。 */
export function isDogeProgramControlTitle(
  text: string | null | undefined,
): boolean {
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) {
    return false;
  }
  // doge 新协议与旧 MOSSX 协议开头的程序内部 session 一律隐藏。
  // 行首匹配可兼容 previewThreadName 截断；用户讨论句（非行首）不误伤。
  return normalized.startsWith("DOGE_") || normalized.startsWith("MOSSX_");
}

export function classifyContextProtocolText(
  text: string,
): ContextProtocolKind | null {
  const normalized = text.trim();
  if (PACKAGE_MARKER.test(normalized)) {
    return "context-package";
  }
  if (ACCEPTED_MARKER.test(normalized)) {
    return "context-accepted";
  }
  if (NATIVE_CONTEXT_PROMPT.test(normalized)) {
    return "native-context-prompt";
  }
  if (SHARED_RUNTIME_PROMPT.test(normalized)) {
    return "shared-runtime-prompt";
  }
  return null;
}

export function isContextProtocolConversationItem(
  item: ConversationItem | undefined,
): boolean {
  return (
    item?.kind === "message" &&
    classifyContextProtocolText(item.text) !== null
  );
}

function contextProtocolMarkerIdentity(
  text: string,
  kind: "context-package" | "context-accepted",
): string {
  const markerKind = kind === "context-package" ? "PACKAGE" : "ACCEPTED";
  return text
    .trim()
    .replace(new RegExp(`^(?:DOGE|MOSSX)_CONTEXT_${markerKind}:`), "");
}

function closeStructuredEnvelope(
  structuredEnvelopeStack: string[],
  acceptedIdentity: string,
): void {
  const matchingPackageIndex =
    structuredEnvelopeStack.lastIndexOf(acceptedIdentity);
  if (matchingPackageIndex >= 0) {
    // 外层 accepted 同时结束它内部遗留的旧版未闭合 package marker，
    // 避免多次 Provider 续接后把后续真实用户消息永久吞掉。
    structuredEnvelopeStack.splice(matchingPackageIndex);
  }
}

function isCodexEnvironmentContextItem(item: ConversationItem): boolean {
  return (
    item.kind === "message" &&
    item.role === "user" &&
    CODEX_ENVIRONMENT_CONTEXT.test(item.text.trim())
  );
}

function hasProtocolBoundary(items: ConversationItem[]): boolean {
  return items.some(
    (item) =>
      item.kind === "message" &&
      classifyContextProtocolText(item.text) !== null,
  );
}

type ContextProtocolScanResult = {
  visibleItems: ConversationItem[] | null;
  hasControlTail: boolean;
};

function scanContextProtocolConversationItems(
  items: ConversationItem[],
  options: ContextProtocolFilterOptions,
  collectVisibleItems: boolean,
): ContextProtocolScanResult {
  const structuredEnvelopeStack: string[] = [];
  const shouldHideLeadingBootstrap =
    options.hideLeadingContinuationBootstrap === true;
  let insideLeadingBootstrap =
    shouldHideLeadingBootstrap && hasProtocolBoundary(items);
  let insideStandaloneEnvironmentPrefix =
    shouldHideLeadingBootstrap && !insideLeadingBootstrap;
  let leadingControlSeen = false;
  let standaloneEnvironmentHidden = false;
  let insidePromptControlExchange = false;
  const visibleItems: ConversationItem[] | null = collectVisibleItems
    ? []
    : null;
  const keep = (item: ConversationItem) => {
    visibleItems?.push(item);
  };

  for (const item of items) {
    const protocolText = item.kind === "message" ? item.text : null;
    const protocolKind =
      protocolText === null ? null : classifyContextProtocolText(protocolText);

    if (insideLeadingBootstrap) {
      if (protocolKind === "context-package" && protocolText !== null) {
        structuredEnvelopeStack.push(
          contextProtocolMarkerIdentity(protocolText, protocolKind),
        );
        leadingControlSeen = true;
        continue;
      }
      if (protocolKind === "context-accepted" && protocolText !== null) {
        closeStructuredEnvelope(
          structuredEnvelopeStack,
          contextProtocolMarkerIdentity(protocolText, protocolKind),
        );
        leadingControlSeen = true;
        continue;
      }
      if (
        protocolKind === "native-context-prompt" ||
        protocolKind === "shared-runtime-prompt"
      ) {
        leadingControlSeen = true;
        continue;
      }
      if (!leadingControlSeen || structuredEnvelopeStack.length > 0) {
        continue;
      }
      if (item.kind === "message" && item.role === "user") {
        insideLeadingBootstrap = false;
        keep(item);
      }
      // control prompt 后的 reasoning/assistant 属于 bootstrap output，
      // 第一条真实 user turn 到来前继续隐藏。
      continue;
    }

    if (insideStandaloneEnvironmentPrefix) {
      if (isCodexEnvironmentContextItem(item)) {
        standaloneEnvironmentHidden = true;
        continue;
      }
      insideStandaloneEnvironmentPrefix = false;
      standaloneEnvironmentHidden = false;
    }

    if (protocolKind === "shared-runtime-prompt") {
      // Shared V2 已有 canonical user turn；native Runtime replay 只是 transport
      // echo。只隐藏该重复 user item，不能把随后的 reasoning/assistant 当成
      // bootstrap ACK 一并吞掉。
      continue;
    }
    if (protocolKind === "context-package" && protocolText !== null) {
      structuredEnvelopeStack.push(
        contextProtocolMarkerIdentity(protocolText, protocolKind),
      );
      continue;
    }
    if (protocolKind === "context-accepted" && protocolText !== null) {
      closeStructuredEnvelope(
        structuredEnvelopeStack,
        contextProtocolMarkerIdentity(protocolText, protocolKind),
      );
      continue;
    }
    if (protocolKind === "native-context-prompt") {
      insidePromptControlExchange = true;
      continue;
    }
    if (structuredEnvelopeStack.length > 0) {
      continue;
    }
    if (item.kind === "message" && item.role === "user") {
      insidePromptControlExchange = false;
      keep(item);
      continue;
    }
    if (!insidePromptControlExchange) {
      keep(item);
    }
  }

  return {
    visibleItems,
    hasControlTail:
      insideLeadingBootstrap ||
      standaloneEnvironmentHidden ||
      structuredEnvelopeStack.length > 0 ||
      insidePromptControlExchange,
  };
}

/**
 * Context bootstrap 是 control exchange：
 * - structured import 由 exact PACKAGE/ACCEPTED identity 形成可嵌套 envelope；
 * - prompt transport 延续到下一条普通 user message。
 * 只在 presentation boundary 过滤，vendor history 仍完整保留。
 */
export function filterContextProtocolConversationItems(
  items: ConversationItem[],
  options: ContextProtocolFilterOptions = {},
): ConversationItem[] {
  return (
    scanContextProtocolConversationItems(items, options, true).visibleItems ?? []
  );
}

export function hasContextProtocolControlTail(
  items: ConversationItem[],
  options: ContextProtocolFilterOptions = {},
): boolean {
  return scanContextProtocolConversationItems(items, options, false)
    .hasControlTail;
}
