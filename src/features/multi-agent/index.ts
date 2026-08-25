export { MultiAgentComposerToggle, isMultiAgentTargetSupported } from "./components/ComposerToggle";
export { MultiAgentConversationSurface } from "./components/ConversationSurface";
export { MultiAgentConversationHost } from "./components/ConversationHost";
export { AgentInspectorDrawer } from "./components/AgentInspectorDrawer";
export { TemplateManagerModal } from "./components/TemplateManagerModal";
export { StageTargetPicker } from "./components/StageTargetPicker";
export {
  openAgentInspector,
  closeAgentInspector,
  selectAgentRound,
  useAgentInspectorSelection,
} from "./store/inspectorStore";
export { isMultiAgentEnabled } from "./runtime/featureFlag";
export { multiAgentContextBlockReason } from "./runtime/contextGate";
export {
  requestAgentPlan,
  approveAndExecuteAgent,
  rejectAndReplanAgent,
  stopAgent,
  forceStopAndUnlock,
  retryCollabRun,
  retryAgentStage,
  hydrateAgentProjection,
  isActiveAgentProjection,
} from "./runtime/executor";
export {
  registerCollabThreadProcessingMarker,
  setCollabThreadProcessing,
  applyCollabThreadProcessingFromProjection,
  applyCollabThreadProcessingFromStatus,
  restoreCollabThreadProcessingIfActive,
} from "./runtime/collabThreadProcessingBridge";
export { subscribeMultiAgentConversationItems } from "./runtime/conversationBridge";
export {
  useAgentProjection,
  useAgentRoundList,
  publishAgentProjection,
  isAgentAttempt,
  findCanonicalAgentRunId,
  registerAgentConversationEvidence,
  getAgentEvidenceRunId,
} from "./store/agentStore";
export {
  getSelectedTemplate,
  selectTemplate,
  useSelectedTemplate,
} from "./templates/templateStore";
export { templateToStageBindings, templateFlowLabel } from "./templates/types";
export { isTerminalAgentStatus } from "./types";
export type { AgentProjectionV1, AgentRunStatus } from "./types";
export type { CollaborationTemplate } from "./templates/types";
export {
  multiAgentUserItemId,
  multiAgentHistFoldItemId,
  filterMultiAgentCanvasItems,
  isMultiAgentSettledSummaryItemId,
} from "@/conversation-presentation/multi-agent/canvasItems";
export {
  stripCollabInternalPrompt,
  isCollabInternalPromptText,
  COLLAB_BRIEFING_MARKER,
  COLLAB_SUMMARY_MARKER,
} from "@/conversation-presentation/multi-agent/collabPrompt";
