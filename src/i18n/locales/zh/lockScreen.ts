// lockScreen — Simplified Chinese UI strings
const lockScreen = {
  lockScreen: {
    lock: "锁屏",
    locked: "已锁定",
    brandKicker: "doge Product Atlas",
    title: "doge 安全锁屏 · 工程能力总览",
    description:
      "会话与任务在后台持续运行。你可以在锁屏页快速复盘 doge 的完整工程链路：从需求规划、执行编排、代码审阅到交付归档。",
    tabLabel: "锁屏内容切换",
    tabs: {
      live: "实时会话",
      capabilities: "能力图谱",
      workflow: "交付流程",
      elements: "元素介绍",
    },
    liveTitle: "实时会话流",
    liveDesc: "仅展示运行中的会话输出，按最近更新时间自动刷新。",
    liveEmpty: "当前没有运行中的会话输出。",
    liveRunning: "运行中",
    capabilityTitle: "能力图谱",
    capabilityDesc:
      "这不是聊天壳，而是一套围绕工程生产力构建的本地优先 AI 工作台。",
    journeyTitle: "典型工作流",
    journeyDesc: "一个需求在 doge 中通常这样落地：",
    elementsTitle: "界面元素介绍",
    elementsDesc: "锁屏页可直接回看核心模块职责，便于团队协作时统一认知。",
    unlockTitle: "解锁面板",
    unlockDesc:
      "密码文件为 ~/.doge/client/pwd.txt。若文件缺失将允许解锁并自动创建默认密码文件。",
    passwordInput: "输入解锁密码",
    passwordPlaceholder: "请输入密码",
    passwordHint: "输入密码后按 Enter 或点击按钮解锁。",
    unlock: "解锁",
    invalidPassword: "密码错误，请重试。",
    storageTitle: "密码存储位置",
    storageDesc: "如需修改密码，请直接编辑该文件内容并保存。",
    storagePathLabel: "文件路径",
    facts: {
      integrationsLabel: "多引擎编排",
      integrationsValue: "Codex / Claude / Gemini",
      workflowLabel: "工程闭环",
      workflowValue: "Plan → Execute → Review → Ship",
      runtimeLabel: "运行状态",
      runtimeValue: "锁屏不中断会话执行",
    },
    journey: {
      planTitle: "Plan First",
      planDesc: "在改代码前先澄清边界、输出方案与任务拆分，降低返工成本。",
      executeTitle: "Execute With Context",
      executeDesc:
        "按 workspace/thread 上下文执行，支持 Kanban 任务直投与多会话并行。",
      reviewTitle: "Review With Trace",
      reviewDesc:
        "保留工具调用轨迹、diff 与调试信息，让问题定位和验收更可追溯。",
      deliverTitle: "Deliver Cleanly",
      deliverDesc: "串联提交、分支、PR 与归档动作，把过程沉淀为团队资产。",
    },
    features: {
      workspaceGraphTitle: "Workspace Graph",
      workspaceGraphDesc:
        "按项目分组管理仓库、工作树、排序与连接状态，秒级切换上下文。",
      threadOrchestrationTitle: "Thread Orchestration",
      threadOrchestrationDesc:
        "支持历史回放、队列消息、手动中断、自动命名与跨线程延续。",
      engineRoutingTitle: "Engine Routing",
      engineRoutingDesc:
        "在模型/推理强度/访问模式/协作模式之间快速切换，任务匹配引擎能力。",
      gitIntelligenceTitle: "Git Intelligence",
      gitIntelligenceDesc:
        "Diff、Log、Commit、PR、Issue 一体化，减少“切窗口-丢上下文”的摩擦。",
      kanbanDispatchTitle: "Kanban Dispatch",
      kanbanDispatchDesc:
        "从看板任务一键创建并驱动会话执行，支持任务状态与处理进度联动。",
      memoryEngineTitle: "Memory Engine",
      memoryEngineDesc:
        "对项目认知进行持久化沉淀，让后续会话无需重复解释同一背景。",
      unifiedSearchTitle: "Unified Search",
      unifiedSearchDesc:
        "跨文件、会话、消息、skills、commands 的统一检索入口。",
      terminalObservabilityTitle: "Terminal + Observability",
      terminalObservabilityDesc:
        "内置终端与调试日志，工具调用链路可见，问题定位更快。",
      composerControlTitle: "Composer Control",
      composerControlDesc:
        "编辑器预设、快捷键、围栏策略、粘贴策略、语音输入统一配置。",
      promptAssetsTitle: "Prompt Assets",
      promptAssetsDesc:
        "支持 workspace/global prompt 资产管理与复用，降低重复输入成本。",
      collaborationModeTitle: "Collaboration Modes",
      collaborationModeDesc:
        "可在不同协作策略间切换，以适配探索、执行、评审等阶段。",
      openEcosystemTitle: "Open Ecosystem",
      openEcosystemDesc:
        "Open in、插件化能力与外部工具协同，保持工程流程开放可扩展。",
    },
    elements: {
      titlebarTitle: "Titlebar Controls",
      titlebarDesc:
        "统一承载项目切换、分支操作、打开方式、锁屏与复制线程动作。",
      sidebarTitle: "Workspace Sidebar",
      sidebarDesc:
        "管理 workspace/worktree、会话分组、搜索过滤与最近活动入口。",
      composerTitle: "Composer Workspace",
      composerDesc:
        "支持富文本输入、代码围栏、快捷命令、语音输入和上下文拼装。",
      gitPanelTitle: "Git Hub",
      gitPanelDesc:
        "集成 diff/log/commit/pr/issue 信息，减少在外部工具间来回切换。",
      kanbanTitle: "Kanban Dispatch",
      kanbanDesc: "任务可一键投递到 AI 会话执行，保持状态与处理进度可追踪。",
      searchTitle: "Unified Search",
      searchDesc: "跨文件、会话、消息、skills 与 commands 的统一搜索入口。",
      memoryTitle: "Memory Engine",
      memoryDesc: "沉淀长期项目知识，降低后续会话重复输入与上下文损耗。",
      debugTitle: "Terminal + Debug",
      debugDesc: "内置终端与调试日志，帮助追踪工具调用链与排障路径。",
    },
  },
};

export default lockScreen;
