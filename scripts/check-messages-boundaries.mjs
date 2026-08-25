#!/usr/bin/env node

import path from "node:path";
import {
  analyzeMessagesBoundaries,
  formatMessagesBoundaryReport,
} from "./lib/messagesBoundaryChecker.mjs";

const BASELINE = {
  inbound: [],
  outbound: [
    "src/features/messages/components/chatCanvasSmoke.test.tsx|import|../../threads/contracts/conversationAssembler",
    "src/features/messages/components/chatCanvasSmoke.test.tsx|import|../../threads/contracts/conversationCurtainContracts",
    "src/features/messages/components/conversation/MessageForkConfirmDialog.tsx|import|../../../threads/constants/codexProviderProfiles",
    "src/features/messages/components/conversation/MessagesInlinePrompts.tsx|import|../../../app/components/ApprovalToasts",
    "src/features/messages/components/conversation/MessagesInlinePrompts.tsx|import|../../../app/components/RequestUserInputMessage",
    "src/features/messages/components/conversation/MessagesOutlineFloater.test.tsx|import|../../../markdown/fastMarkdownRenderer",
    "src/features/messages/components/conversation/MessagesOutlineFloater.tsx|import|../../../markdown/fastMarkdownRenderer",
    "src/features/messages/components/Messages.live-behavior.test.tsx|import|../../threads/contracts/conversationCurtainContracts",
    "src/features/messages/components/Messages.live-markdown-streaming.test.tsx|import|../../threads/contracts/conversationCurtainContracts",
    "src/features/messages/components/Messages.test.tsx|import|../../tasks/types",
    "src/features/messages/components/Messages.windows-render-mitigation.test.tsx|import|../../threads/contracts/conversationCurtainContracts",
    "src/features/messages/components/Messages.windows-render-mitigation.test.tsx|mock|../../threads/utils/streamLatencyDiagnostics",
    "src/features/messages/components/MessagesCore.tsx|import|../../threads/hooks/useStreamActivityPhase",
    "src/features/messages/components/MessagesCore.tsx|import|../../threads/utils/streamLatencyDiagnostics",
    "src/features/messages/contracts/messagesInput.ts|import|../../threads/contracts/conversationCurtainContracts",
    "src/features/messages/hooks/useConversationNoteCaptureMenu.ts|import|../../note-cards/types",
    "src/features/messages/hooks/useMessageOutlineActive.test.tsx|import|../../markdown/fastMarkdownRenderer",
    "src/features/messages/hooks/useMessageOutlineActive.ts|import|../../markdown/fastMarkdownRenderer",
    "src/features/messages/orchestration/components/MessagesLinkedRunBanner.tsx|import|../../../tasks/utils/taskRunSurface",
    "src/features/messages/orchestration/models/messagesTimelineModels.ts|import|../../../threads/utils/streamLatencyDiagnostics",
    "src/features/messages/presentation/messagesOutlineState.test.ts|import|../../markdown/fastMarkdownRenderer",
    "src/features/messages/presentation/messagesOutlineState.ts|import|../../markdown/fastMarkdownRenderer",
    "src/features/messages/presentation/messagesReasoning.ts|import|../../threads/contracts/conversationCurtainContracts",
    "src/features/messages/rows/components/MessageRow.tsx|import|../../../engine-task-output/components/EngineTaskOutputInspector",
    "src/features/messages/rows/components/MessageRow.tsx|import|../../../engine-task-output/hooks/useEngineTaskOutputSnapshot",
    "src/features/messages/rows/components/MessageRow.tsx|import|../../../engine-task-output/types",
    "src/features/messages/rows/components/MessageRow.tsx|import|../../../engine-task-output/utils/engineTaskOutputProjection",
    "src/features/messages/rows/components/MessageRow.tsx|import|../../../threads/hooks/useLiveAssistantText",
    "src/features/messages/rows/components/MessageRow.tsx|import|../../../threads/utils/streamLatencyDiagnostics",
    "src/features/messages/rows/components/PresentationRows.tsx|import|../../../git/components/DiffBlock",
    "src/features/messages/rows/presentation/messagesStreamingComplexity.ts|import|../../../threads/utils/streamLatencyDiagnostics",
    "src/features/messages/types/messagesTypes.ts|import|../../note-cards/types",
    "src/features/messages/types/messagesTypes.ts|import|../../tasks/types",
    "src/features/messages/types/messagesTypes.ts|import|../../threads/contracts/conversationCurtainContracts",
    "src/features/messages/utils/context/messagesMemoryContext.ts|import|../../../project-memory/utils/memoryMarkers",
    "src/features/messages/utils/context/messagesMemoryContext.ts|import|../../../project-memory/utils/projectMemoryRetrievalPack",
    "src/features/messages/utils/context/messagesMemoryContext.ts|import|../../../threads/assembly/conversationNormalization",
    "src/features/messages/utils/context/messagesNoteCardContext.ts|import|../../../note-cards/utils/noteCardContextInjection",
    "src/features/messages/utils/context/messagesNoteCardContext.ts|import|../../../threads/assembly/conversationNormalization",
    "src/features/messages/utils/messagesRenderUtils.ts|import|../../threads/contracts/conversationCurtainContracts",
  ],
};

function readRootArgument(args) {
  const rootIndex = args.indexOf("--root");
  if (rootIndex === -1) {
    return process.cwd();
  }
  const root = args[rootIndex + 1];
  if (!root) {
    throw new Error("--root requires a directory");
  }
  return path.resolve(root);
}

const report = analyzeMessagesBoundaries({
  repoRoot: readRootArgument(process.argv.slice(2)),
  baseline: BASELINE,
});
const output = formatMessagesBoundaryReport(report, BASELINE);

if (report.violations.length > 0) {
  console.error(output);
  process.exitCode = 1;
} else {
  console.log(output);
}
