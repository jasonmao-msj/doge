// intentCanvas — English UI strings
const intentCanvas = {
  intentCanvas: {
    untitled: "Untitled Intent Canvas",
    loading: "Loading canvases...",
    saving: "Saving...",
    saved: "Saved",
    unsaved: "Unsaved",
    errors: {
      noWorkspace: "Select a workspace before using Intent Canvas.",
      noThread: "No available thread for sending Intent Canvas.",
    },
    manager: {
      ariaLabel: "Intent Canvas manager",
      title: "Intent Canvas Manager",
      subtitle:
        "Manage durable logic sketches, architecture whiteboards, and conversation context files for this project.",
      refresh: "Refresh",
      projectMap: "Project Map",
      newCanvas: "New Canvas",
      selectAll: "Select all",
      clearSelection: "Clear selection",
      selectedCount: "{{count}} canvas(es) selected",
      selectCanvas: "Select canvas “{{title}}”",
      selectCanvasShort: "Select",
      deleteSelected: "Delete selected {{count}}",
      bulkDelete: "Bulk delete",
      searchPlaceholder: "Search title, summary, or file path...",
      count: "{{count}} canvas(es)",
      emptyTitle: "No canvases yet",
      emptyBody:
        "Create the first diagram to sketch business intent, module relationships, and problem context.",
      noWorkspaceTitle: "Select a workspace",
      noWorkspaceBody:
        "Intent Canvas writes files under the global ~/.doge/project-canvas directory, partitioned by project.",
      noSummary: "No summary yet.",
      elements: "Elements",
      files: "Files",
      nodes: "Nodes",
      updated: "Updated {{time}}",
      open: "Open",
      duplicate: "Duplicate",
      delete: "Delete",
      openConfirm:
        "Open canvas “{{title}}”? The list will switch to the editor.",
      openHint:
        "If another editor has unsaved work, save it before opening this canvas.",
      duplicateConfirm:
        "Duplicate canvas “{{title}}”? A new Canvas copy will be created.",
      duplicateHint:
        "The copy will be written under the global ~/.doge/project-canvas directory, partitioned by project.",
      deleteConfirm:
        "Delete canvas “{{title}}”? The file will be moved to trash.",
      deleteHint:
        "This does not delete chat messages. It only removes the Canvas file from global project-canvas storage.",
      bulkDeleteConfirm:
        "Delete {{count}} selected canvas(es)? The files will be moved to trash.",
      bulkDeleteHint:
        "This does not delete chat messages. It only removes selected Canvas files from global project-canvas storage.",
    },
    editor: {
      ariaLabel: "Intent Canvas editor",
      back: "Back to manager",
      backToProjectMap: "Back to Project Knowledge Map",
      save: "Save",
      sendToThread: "Attach to current session",
      attachToThread: "Attach to current session",
      metadata: "Canvas metadata",
      title: "Title",
      summary: "Intent summary",
      summaryPlaceholder:
        "What does this diagram explain? What are the boundaries, assumptions, and key questions?",
      links: "Structured links",
      fileLinks: "Linked files",
      projectMapNodeLinks: "Linked Project Map nodes",
      threadLinks: "Linked threads",
      aiContext: "AI Context",
      aiContextHint:
        "The chat receives a structured digest and JSON snapshot, not a screenshot.",
      elements: "Elements",
      files: "Files",
      nodes: "Nodes",
      contextPreview: "Context Preview",
      updated: "Updated {{time}}",
      leftRail: "Canvas info",
      rightRail: "AI Context",
      collapseLeftRail: "Collapse left panel",
      expandLeftRail: "Expand left panel",
      collapseRightRail: "Collapse right panel",
      expandRightRail: "Expand right panel",
      sourceTraceability: "Source traceability",
      sourceTraceabilityHint:
        "Imported code graph groups keep source anchors, evidence refs, and refresh state separate from manual drawing content.",
      sourceImportedGraphs: "Imported graphs",
      sourceStaleGraphs: "Stale",
      sourceUnresolvedAnchors: "Unresolved",
      sourceStatusLoading: "Checking latest relationship snapshot.",
      sourceStatusError: "Source check failed: {{message}}",
      sourceStatusUnavailable:
        "No relationship snapshot is available. Canvas content is kept editable.",
      sourceLatestScan: "Latest relationship scan: {{scanRunId}}",
      sourceStaleNotice: "{{count}} imported graph(s) came from an older scan.",
      sourceUnresolvedNotice:
        "{{count}} source anchor(s) no longer resolve in the latest relationship snapshot.",
      sourceCodeSelection: "Code selection",
      sourceOpenCodeSelection: "Open {{path}}:{{line}}",
      sourceFiles: "Source files",
      sourceOpenFile: "Open {{path}}",
      sourceOpenFileAtLine: "Open {{path}}:{{line}}",
      sourceOpenUnavailable: "This source anchor no longer resolves.",
      sourceEvidence: "Evidence",
      sourceEvidenceOpen: "Inspect evidence for {{label}}",
      sourceEvidenceNoFile: "This evidence ref has no file-backed source.",
      sourceRefresh: "Re-project from Project Map",
      sourceRefreshHint:
        "Return to Project Knowledge Map and import the current resolved graph again.",
    },
    attachment: {
      groupLabel: "Attached Intent Canvas",
      attached:
        "Attached to the current session. It will be injected as JSON context when sent.",
      contextComplete: "Context complete",
      contextCompressed: "Context compressed",
      contextStatusAriaLabel: "Intent Canvas send context status",
      elementDigest: "Digest elements {{sent}}/{{total}}",
      omittedElements: "{{count}} element(s) omitted",
      semanticNodes: "Semantic nodes {{sent}}/{{total}}",
      semanticEdges: "Relations {{sent}}/{{total}}",
      visualTextBlocks: "Text clues {{sent}}/{{total}}",
      remove: "Remove canvas “{{title}}”",
    },
  },
};

export default intentCanvas;
