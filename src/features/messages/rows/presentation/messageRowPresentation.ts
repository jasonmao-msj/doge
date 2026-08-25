import type { ConversationItem } from "../../../../types";
import {
  isSubagentStyleAgentTaskNotification,
  parseAgentTaskNotification,
} from "@/contracts/agentTaskNotification";
import {
  buildMessagePresentationMetadata,
  getPresentationContext,
  getPresentationContexts,
} from "../../../../conversation-presentation/normalizeConversationPresentation";
import { resolveUserMessagePresentation } from "../../presentation/messagesUserPresentation";
import { parseUserTextContent } from "../../components/context/parseUserTextContent";
import type { MessageImage } from "../../components/media/MessageMediaBlocks";
import { normalizeMessageImageSrc } from "../../utils/messagesRenderUtils";

type MessageItem = Extract<ConversationItem, { kind: "message" }>;

/**
 * Recover a filesystem path for LocalImage fallback from a message image entry.
 * Returns null for pure data:/http(s) sources that need no disk read.
 */
export function resolveMessageImageLocalPath(image: string): string | null {
  const trimmed = image.trim();
  if (!trimmed) {
    return null;
  }
  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return null;
  }
  if (trimmed.startsWith("file://")) {
    try {
      const withoutScheme = decodeURIComponent(trimmed.slice("file://".length));
      const hostless = withoutScheme.startsWith("localhost/")
        ? withoutScheme.slice("localhost/".length)
        : withoutScheme;
      if (/^\/[A-Za-z]:[\\/]/.test(hostless)) {
        return hostless.slice(1);
      }
      if (/^[A-Za-z]:[\\/]/.test(hostless)) {
        return hostless;
      }
      return hostless.startsWith("/") ? hostless : `/${hostless}`;
    } catch {
      return null;
    }
  }
  // Absolute POSIX / Windows path
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed) || /^\\\\[^\\]/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function normalizeNoteCardImageIdentity(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const hasWindowsDrivePrefix = (candidate: string) => /^[A-Za-z][:|][\\/]/.test(candidate);
  const hasWindowsDriveHost = (candidate: string) => /^[A-Za-z][:|]/.test(candidate);
  const decodePath = (candidate: string) => {
    try {
      return decodeURIComponent(candidate);
    } catch {
      return candidate;
    }
  };

  let withoutFileScheme = trimmed;
  const lowerCased = trimmed.toLowerCase();
  if (lowerCased.startsWith("asset://localhost")) {
    withoutFileScheme = trimmed.slice("asset://localhost".length);
    if (!withoutFileScheme.startsWith("/")) {
      withoutFileScheme = `/${withoutFileScheme}`;
    }
    if (withoutFileScheme.startsWith("//")) {
      withoutFileScheme = withoutFileScheme.slice(1);
    }
    withoutFileScheme = decodePath(withoutFileScheme);
  } else if (lowerCased.startsWith("file://")) {
    const remainder = trimmed.slice("file://".length).trim();
    if (!remainder) {
      return "";
    }
    if (/^localhost\//i.test(remainder)) {
      withoutFileScheme = decodePath(remainder.replace(/^localhost\//i, ""));
    } else if (
      !remainder.startsWith("/") &&
      !hasWindowsDrivePrefix(remainder) &&
      !hasWindowsDriveHost(remainder)
    ) {
      const slashIndex = remainder.indexOf("/");
      if (slashIndex === -1) {
        withoutFileScheme = `//${remainder}`;
      } else {
        const host = remainder.slice(0, slashIndex);
        const tail = remainder.slice(slashIndex);
        withoutFileScheme = `//${host}${decodePath(tail)}`;
      }
    } else {
      withoutFileScheme = decodePath(remainder.replace(/\|/g, ":"));
    }
    if (
      !withoutFileScheme.startsWith("/") &&
      !hasWindowsDrivePrefix(withoutFileScheme) &&
      !hasWindowsDriveHost(withoutFileScheme)
    ) {
      withoutFileScheme = `/${withoutFileScheme}`;
    }
  }
  const normalized = withoutFileScheme.replace(/\\/g, "/");
  if (/^\/[A-Za-z]:\//.test(normalized)) {
    return normalized.slice(1).toLowerCase();
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.toLowerCase();
  }
  return normalized;
}

export function buildMessageRowPresentation(input: {
  item: MessageItem;
  enableCollaborationBadge: boolean;
  suppressMemorySummaryCard: boolean;
  suppressNoteCardSummaryCard: boolean;
}) {
  const {
    item,
    enableCollaborationBadge,
    suppressMemorySummaryCard,
    suppressNoteCardSummaryCard,
  } = input;
  const presentationMetadata = buildMessagePresentationMetadata(item, {
    enableCollaborationBadge,
  });
  const userMessagePresentation = item.role === "user"
    ? resolveUserMessagePresentation({
      text: item.text,
      selectedAgentName: item.selectedAgentName,
      selectedAgentIcon: item.selectedAgentIcon,
      presentationMetadata,
      enableCollaborationBadge,
    })
    : null;
  const memoryContext = getPresentationContext(presentationMetadata, "memory");
  const noteCardContext = getPresentationContext(presentationMetadata, "note-card");
  const memorySummary = userMessagePresentation?.memorySummary ?? (memoryContext
    ? {
        preview: memoryContext.preview,
        lines: memoryContext.lines,
        markdown: memoryContext.markdown,
        rawPayload: memoryContext.rawPayload,
        memoryPacks: memoryContext.packs,
        source: memoryContext.source,
        records: memoryContext.records,
      }
    : null);
  const noteCardSummary = userMessagePresentation?.noteCardSummary ?? (noteCardContext
    ? { notes: noteCardContext.notes, imagePaths: noteCardContext.imagePaths }
    : null);
  const resolvedMemorySummary = suppressMemorySummaryCard ? null : memorySummary;
  const resolvedNoteCardSummary = suppressNoteCardSummaryCard ? null : noteCardSummary;
  const agentTaskNotification = parseAgentTaskNotification(item.text);
  /** SubAgent 型 notification：退役 legacy Agent session 卡与 result 独立气泡 */
  const suppressSubagentAgentTaskCard = isSubagentStyleAgentTaskNotification(
    agentTaskNotification,
  );
  const browserContextSummary = item.role === "user"
    ? getPresentationContext(presentationMetadata, "browser")
    : null;
  const intentCanvasContextSummary = item.role === "user"
    ? getPresentationContexts(presentationMetadata, "intent-canvas")
    : [];
  const shouldHideSuppressedInjectedContextText =
    item.role === "user" &&
    !agentTaskNotification &&
    (
      (
        suppressMemorySummaryCard &&
        Boolean(memorySummary) &&
        (userMessagePresentation?.stickyCandidateText ?? "").trim().length === 0
      ) ||
      (
        suppressNoteCardSummaryCard &&
        Boolean(noteCardSummary) &&
        (userMessagePresentation?.stickyCandidateText ?? "").trim().length === 0
      )
    );
  const displayText = agentTaskNotification
    ? suppressSubagentAgentTaskCard
      ? ""
      : agentTaskNotification.resultText
    : item.role === "user"
      ? (shouldHideSuppressedInjectedContextText
        ? ""
        : userMessagePresentation?.displayText ?? presentationMetadata.displayText)
      : resolvedMemorySummary || resolvedNoteCardSummary
        ? ""
        : item.text;
  const selectedAgentName = userMessagePresentation?.selectedAgentName ?? null;
  const selectedAgentIcon = userMessagePresentation?.selectedAgentIcon ?? null;
  const hasInjectedAgentPromptBlock =
    userMessagePresentation?.hasInjectedAgentPromptBlock ?? false;
  const hasExternalAgentBadge =
    item.role === "user" &&
    !agentTaskNotification &&
    (Boolean(selectedAgentName) || hasInjectedAgentPromptBlock);
  const hasText = displayText.trim().length > 0;
  const parsedUserTextContent =
    item.role === "user" && !agentTaskNotification && hasText
      ? parseUserTextContent(displayText)
      : null;
  const noteCardImagePathSet = new Set(
    (noteCardSummary?.imagePaths ?? []).map(normalizeNoteCardImageIdentity),
  );
  const imageItems: MessageImage[] = (item.images ?? []).flatMap((image, index) => {
    if (noteCardImagePathSet.has(normalizeNoteCardImageIdentity(image))) {
      return [];
    }
    // Keep absolute path / file:// for LocalImage fallback when asset:// fails
    // (common with non-ASCII workspace paths like Chinese folder names).
    const localPath = resolveMessageImageLocalPath(image);
    const normalizedSrc = normalizeMessageImageSrc(image);
    // Prefer convertFileSrc / data URL; if protocol conversion yields empty but
    // we still have a disk path, seed a file:// src so LocalImage can fall back.
    const src =
      normalizedSrc ||
      (localPath
        ? localPath.startsWith("/")
          ? `file://${localPath}`
          : `file:///${localPath.replace(/\\/g, "/")}`
        : "");
    if (!src) {
      return [];
    }
    return [{ src, label: `Image ${index + 1}`, localPath }];
  });

  return {
    resolvedMemorySummary,
    resolvedNoteCardSummary,
    memorySummaryRecords: resolvedMemorySummary?.records ?? [],
    memorySummaryRawPayload: resolvedMemorySummary?.rawPayload?.trim() ?? "",
    memoryPayloadPacks: resolvedMemorySummary?.memoryPacks ?? [],
    agentTaskNotification,
    suppressSubagentAgentTaskCard,
    browserContextSummary,
    intentCanvasContextSummary,
    displayText,
    canUseLiveAssistantText:
      item.role === "assistant" &&
      !agentTaskNotification &&
      !resolvedMemorySummary &&
      !resolvedNoteCardSummary,
    messageRowSubtype:
      agentTaskNotification && !suppressSubagentAgentTaskCard
        ? ("agent-task" as const)
        : item.role === "assistant"
          ? ("assistant" as const)
          : ("user" as const),
    selectedAgentName,
    selectedAgentIcon,
    hasExternalAgentBadge,
    parsedUserTextContent,
    imageItems,
  };
}
