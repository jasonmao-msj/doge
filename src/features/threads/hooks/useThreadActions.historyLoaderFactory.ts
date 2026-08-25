import {
  loadCodexSession as loadCodexSessionService,
  loadClaudeSession as loadClaudeSessionService,
  loadGeminiSession as loadGeminiSessionService,
  loadGrokSession as loadGrokSessionService,
  loadKimiSession as loadKimiSessionService,
  resumeThread as resumeThreadService,
} from "../../../services/tauri";
import { createClaudeHistoryLoader } from "../loaders/claudeHistoryLoader";
import { createCodexHistoryLoader } from "../loaders/codexHistoryLoader";
import { createGeminiHistoryLoader } from "../loaders/geminiHistoryLoader";
import { createGrokHistoryLoader } from "../loaders/grokHistoryLoader";
import { createKimiHistoryLoader } from "../loaders/kimiHistoryLoader";
import { createOpenCodeHistoryLoader } from "../loaders/opencodeHistoryLoader";
import { createSharedHistoryLoader } from "../loaders/sharedHistoryLoader";
import {
  loadSharedProjection as loadSharedProjectionService,
  loadSharedSession as loadSharedSessionService,
} from "../../shared-session/services/sharedSessions";
import type { HistoryLoadingProgressListener } from "@/conversation-presentation/historyLoadingProgress";

export function createThreadHistoryLoaderForThread({
  targetThreadId,
  workspaceId,
  workspacePath,
  preferLocalCodexHistory,
  onHistoryProgress,
}: {
  targetThreadId: string;
  workspaceId: string;
  workspacePath: string | null;
  preferLocalCodexHistory: boolean;
  onHistoryProgress?: HistoryLoadingProgressListener;
}) {
  if (targetThreadId.startsWith("shared:")) {
    return createSharedHistoryLoader({
      workspaceId,
      loadSharedSession: loadSharedSessionService,
      loadSharedProjection: loadSharedProjectionService,
      onProgress: onHistoryProgress,
    });
  }
  if (targetThreadId.startsWith("claude:")) {
    return createClaudeHistoryLoader({
      workspaceId,
      workspacePath,
      loadClaudeSession: loadClaudeSessionService,
    });
  }
  if (targetThreadId.startsWith("gemini:")) {
    return createGeminiHistoryLoader({
      workspaceId,
      workspacePath,
      loadGeminiSession: loadGeminiSessionService,
    });
  }
  if (targetThreadId.startsWith("grok:")) {
    return createGrokHistoryLoader({
      workspaceId,
      workspacePath,
      loadGrokSession: loadGrokSessionService,
    });
  }
  if (targetThreadId.startsWith("kimi:")) {
    return createKimiHistoryLoader({
      workspaceId,
      workspacePath,
      loadKimiSession: loadKimiSessionService,
    });
  }
  if (targetThreadId.startsWith("opencode:")) {
    return createOpenCodeHistoryLoader({
      workspaceId,
      resumeThread: resumeThreadService,
    });
  }
  return createCodexHistoryLoader({
    workspaceId,
    resumeThread: resumeThreadService,
    loadCodexSession: loadCodexSessionService,
    preferLocalHistory: preferLocalCodexHistory,
  });
}
