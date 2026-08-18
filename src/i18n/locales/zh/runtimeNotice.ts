// runtimeNotice — Simplified Chinese UI strings
const runtimeNotice = {
  runtimeNotice: {
    title: "运行时提示",
    open: "打开运行时提示",
    minimize: "最小化",
    clear: "清空",
    emptyTitle: "暂无运行时提示",
    emptyDescription: "初始化进度和关键错误会显示在这里",
    statusIdle: "空闲",
    statusError: "异常",
    severityInfo: "提示",
    severityWarning: "警告",
    severityError: "错误",
    bootstrap: {
      start: "正在初始化本地状态...",
      storageMigrationCheck: "正在检查本地状态迁移...",
      inputHistoryRestore: "正在恢复输入历史...",
      interfaceResources: "正在加载界面资源...",
      mountShell: "正在挂载客户端界面...",
      localStorageMigrationFailed: "本地状态迁移失败，已按降级模式继续启动",
      ready: "客户端初始化完成",
      failed: "客户端初始化失败，请刷新后重试",
    },
    startupGate: {
      title: "正在启动",
      message:
        "正在完成初始化（约数秒），请稍候…此期间界面不可操作，避免无响应。",
      forceDismiss: "直接进入",
    },
    startupTimeline: {
      title: "后台工作时间轴",
      summary: "{{rawCount}} 条原始记录 · 合并为 {{nodeCount}} 个节点",
      sections: {
        startup: "启动阶段",
        startupHint: "按 startup trace 顺序",
        runtime: "运行阶段",
        runtimeHint: "按 runtime notice 时间",
      },
      empty: "暂无记录",
      globalProject: "全局",
      projectSummary: "{{name}} +{{count}}",
      count: "×{{count}}",
      duration: {
        single: "用时 {{duration}}",
        total: "累计 {{duration}}",
        unavailable: "耗时 —",
      },
      status: {
        queued: "排队",
        started: "进行中",
        completed: "完成",
        failed: "失败",
        timedOut: "超时",
        cancelled: "取消",
        degraded: "降级",
        info: "提示",
        warning: "警告",
      },
      detail: {
        label: "查看 {{title}} 详情",
        project: "项目",
        workspacePath: "完整路径",
        workspaceId: "Workspace ID",
        workspaceCatalog: "项目清单（来自本地缓存）",
        technical: "技术标识",
        phase: "阶段",
        sources: "来源",
        timing: "耗时明细",
        first: "首次",
        latest: "最近",
        max: "最慢",
        total: "累计",
        durationSamples: "{{count}} 次记录到耗时",
        noPath: "未记录完整路径",
      },
      operations: {
        "workspace-catalog": {
          title: "获取工作区",
          description:
            "读取工作区清单、项目名称与路径，确认后续后台任务应作用于哪些项目；不加载会话正文。",
        },
        "session-catalog": {
          title: "刷新会话列表",
          description:
            "读取该项目下各 CLI 的会话索引、标题与归属，更新侧边栏可恢复会话；不加载完整对话正文。",
        },
        "workspace-files": {
          title: "读取项目文件",
          description: "读取项目文件树索引，供文件面板和路径导航使用。",
        },
        skills: {
          title: "加载 Skills",
          description: "读取项目与全局可用 Skills，供输入区和 Agent 调用。",
        },
        prompts: {
          title: "加载 Prompts",
          description: "读取项目 Prompt 模板，供输入区快速选择和复用。",
        },
        commands: {
          title: "加载 Commands",
          description: "读取 CLI 与项目自定义命令，更新输入区可用命令清单。",
        },
        "collaboration-modes": {
          title: "加载协作模式",
          description: "读取当前引擎支持的 collaboration modes，供会话创建与切换使用。",
        },
        models: {
          title: "刷新模型列表",
          description: "读取当前引擎可用模型与选择项，供会话创建和模型切换使用。",
        },
        agents: {
          title: "加载 Agents",
          description: "读取可用 Agent 清单，供任务分派与输入区选择使用。",
        },
        "git-status": {
          title: "检查 Git 状态",
          description: "读取项目当前分支与文件变更状态，更新 Git 面板提示。",
        },
        "git-diff": {
          title: "读取 Git Diff",
          description: "读取项目文件差异摘要，供变更面板和提交范围判断使用。",
        },
        dictation: {
          title: "检查语音模型",
          description: "检查本地 dictation model 是否可用，供语音输入入口使用。",
        },
        "input-history": {
          title: "恢复输入历史",
          description: "从本地状态恢复输入草稿与历史，避免重启后丢失未完成内容。",
        },
        "storage-migration": {
          title: "检查本地状态迁移",
          description: "检查并迁移旧版本本地状态，使现有设置和缓存继续可读。",
        },
        "storage-preload": {
          title: "预载本地状态",
          description: "预先读取启动所需的轻量本地配置，减少界面挂载后的同步等待。",
        },
        "app-import": {
          title: "加载客户端代码",
          description: "加载主界面模块，为客户端外壳挂载准备运行代码。",
        },
        i18n: {
          title: "加载语言资源",
          description: "加载当前语言的界面文案，确保启动界面和后续页面可本地化显示。",
        },
        "interface-resources": {
          title: "挂载客户端界面",
          description: "准备界面资源并挂载客户端外壳，使主要交互区域进入可渲染状态。",
        },
        "runtime-connection": {
          title: "检查 Runtime 连接",
          description: "跟踪项目 CLI runtime 的连接、恢复与可用状态。",
        },
        "shell-ready": {
          title: "客户端外壳就绪",
          description: "主界面骨架已完成挂载，可以继续加载项目相关数据。",
        },
        "input-ready": {
          title: "输入区就绪",
          description: "输入区已完成必要初始化，可以接收用户交互。",
        },
        "active-workspace-ready": {
          title: "当前项目首屏就绪",
          description: "当前项目的首屏必要数据已收敛，后台可继续补全较重内容。",
        },
        "startup-gate-ready": {
          title: "启动安全门就绪",
          description: "启动期必要任务已收敛到允许解除操作遮罩的状态。",
        },
      },
      fallback: {
        task: "执行一项启动后台任务；具体用途请查看技术标识。",
        command: "调用一项内部命令；具体用途请查看技术标识。",
        milestone: "记录客户端启动过程中的阶段性就绪信号。",
        notice: "记录启动或运行时状态；详情保留原始 notice key。",
      },
    },
    uiScale: {
      startupGuardReset:
        "检测到上次启动在界面缩放 {{scale}}% 时卡死，本次已临时恢复为 100%。您的缩放设置未被修改，可在设置中重新调整。",
    },
    runtime: {
      startupPending: "{{workspace}}：{{engine}} runtime 正在连接...",
      resumePending: "{{workspace}}：Runtime 探活异常，正在尝试恢复",
      ready: "{{workspace}}：{{engine}} runtime 已连接",
      suspectStale: "{{workspace}}：Runtime 探活异常，正在尝试恢复",
      cooldown: "{{workspace}}：Runtime 恢复失败，当前处于冷却期",
      quarantined: "{{workspace}}：Runtime 恢复失败，需要人工关注",
      codexSessionStartHookSkipped:
        "Codex 已跳过项目 SessionStart hook 并创建会话。请检查 `.codex/hooks.json`；项目上下文可能不完整。（{{reason}}）",
    },
    startup: {
      taskStarted: "后台加载开始：{{task}}（{{phase}} / {{workspace}}）",
      taskCompleted: "后台加载完成：{{task}}（{{durationMs}}ms）",
      taskFailed: "后台加载失败：{{task}}",
      taskTimedOut: "后台加载超时：{{task}}，已转入降级路径",
      taskDegraded: "后台加载降级：{{task}}（{{reason}}）",
      taskCancelled: "后台加载取消：{{task}}（{{reason}}）",
      commandCompleted:
        "内部命令完成：{{command}}（{{workspace}} / {{durationMs}}ms）",
      commandFailed:
        "内部命令失败：{{command}}（{{workspace}} / {{durationMs}}ms）",
      shellReady: "客户端外壳已就绪",
      inputReady: "输入区已可交互",
      activeWorkspaceReady: "当前工作区首屏数据已就绪",
    },
    engine: {
      checking: "正在检测 {{engine}} 状态...",
      ready: "{{engine}} 已就绪",
      unavailable: "{{engine}} 未安装，请先安装",
      requiresLogin: "{{engine}} 需先登录",
    },
    codex: {
      providerSelected: "已启用 {{name}}，点击 Codex 即可直接创建会话",
    },
    claude: {
      providerSelected: "已启用 {{name}}，点击 Claude 即可直接创建会话",
      resumeCommandCopied:
        "Claude 恢复命令已复制。如果 TUI 的 /resume picker 看不到这个 GUI 会话，请显式运行 claude --resume {{sessionId}} 或 /resume {{sessionId}}。",
    },
    kimi: {
      providerSelected: "已启用 {{name}}，点击 Kimi 即可直接创建会话",
    },
    grok: {
      providerSelected: "已启用 {{name}}，点击 Grok 即可直接创建会话",
    },
    opencode: {
      providerSelected: "已启用 {{name}}，点击 OpenCode 即可直接创建会话",
    },
    vendor: {
      activateProviderFailed: "启用供应商 {{name}} 失败：{{detail}}",
    },
    error: {
      createSessionRecoveryRequired:
        "{{workspace}}：会话创建失败，运行时正在恢复",
      threadTurnFailed: "{{engine}} 会话失败：{{message}}",
      codexSessionRecoverableFailure:
        "Codex 连接中断：旧会话绑定或运行时连接已失效，请重试或重新连接。",
    },
  },
};

export default runtimeNotice;
