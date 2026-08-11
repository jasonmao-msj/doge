import type {
  ConversationItem,
  EngineType,
  RateLimitSnapshot,
  RateLimitWindow,
  ThreadTokenUsage,
} from "../../../types";
import { formatRateLimitWindowLabel } from "../../../utils/rateLimitLabels";

export type SessionOverviewStatus = "running" | "compacting" | "idle";

export type SessionOverviewThreadStatus = {
  isProcessing?: boolean;
  isContextCompacting?: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
} | null;

/**
 * official_cli: Codex 官方 runtime（account/rateLimits）
 * coding_plan: Kimi/MiniMax/智谱等供应商 API
 * none: 官方无 plan（如 Claude 官方）— UI 应隐藏额度块
 * unsupported / empty / error: 无可用额度
 */
export type SessionOverviewQuotaSource =
  | "official_cli"
  | "coding_plan"
  | "unsupported"
  | "empty"
  | "error"
  | "none";

export type SessionOverviewQuotaWindowView = {
  id: string;
  /** 窗口标签，如 5小时 / 7天 / 5h limit */
  label: string;
  /** 用于进度条与百分比文案的展示值（已按 remaining 设置翻转） */
  displayPercent: number;
  usedPercent: number;
  resetsAt: number | null;
};

export type SessionOverviewUsageSummaryView = {
  totalRequests: number | null;
  totalActualCost: string | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  averageDurationMs: number | null;
};

export type SessionOverviewQuotaView = {
  source: SessionOverviewQuotaSource;
  /** 展示用供应商名：codex / kimi / minimax / zhipu / sub2api */
  providerLabel: string | null;
  showRemaining: boolean;
  planType: string | null;
  windows: SessionOverviewQuotaWindowView[];
  creditsBalance: string | null;
  creditsUnlimited: boolean;
  hasCredits: boolean;
  /** Sub2API 用量明细行 */
  usageSummary: SessionOverviewUsageSummaryView | null;
  error: string | null;
  loading: boolean;
};

export type CodingPlanBalanceInput = {
  isAvailable: boolean;
  items: Array<{
    currency: string;
    totalBalance: string;
    grantedBalance?: string | null;
    toppedUpBalance?: string | null;
  }>;
};

export type CodingPlanUsageSummaryInput = {
  totalRequests?: number | null;
  totalActualCost?: string | null;
  totalInputTokens?: number | null;
  totalOutputTokens?: number | null;
  totalTokens?: number | null;
  averageDurationMs?: number | null;
};

export type CodingPlanQuotaInput = {
  source: string;
  success: boolean;
  error?: string | null;
  planLabel?: string | null;
  windows: Array<{
    id: string;
    usedPercent: number;
    remainingPercent: number;
    resetsAt?: string | null;
  }>;
  /** 余额型（DeepSeek 等）；与 windows 二选一或并存 */
  balance?: CodingPlanBalanceInput | null;
  usageSummary?: CodingPlanUsageSummaryInput | null;
  /** 中转站 origin（变量，非写死文案） */
  siteOrigin?: string | null;
} | null;

/** 共享会话多供应商：每条目独立查额度。 */
export type SessionOverviewQuotaEntryInput = {
  key: string;
  title: string;
  subtitle: string | null;
  engine: EngineType;
  providerProfileId: string | null;
  codingPlanQuota: CodingPlanQuotaInput;
  codingPlanQuotaLoading?: boolean;
};

export type SessionOverviewQuotaEntryView = {
  key: string;
  title: string;
  subtitle: string | null;
  engine: EngineType;
  providerProfileId: string | null;
  quota: SessionOverviewQuotaView;
};

export type SessionOverviewInput = {
  sessionId: string | null;
  engine: EngineType | null;
  model: string | null;
  workspaceName: string | null;
  workspacePath: string | null;
  /** 会话 transcript / 落盘文件路径；没有则不展示。 */
  sessionDiskPath: string | null;
  isProcessing: boolean;
  threadStatus: SessionOverviewThreadStatus;
  items: readonly ConversationItem[];
  tokenUsage: ThreadTokenUsage | null;
  rateLimits: RateLimitSnapshot | null;
  /**
   * 单供应商兼容输入；当 quotaEntries 有值时以 entries 为准。
   * @deprecated 优先传 quotaEntries
   */
  codingPlanQuota?: CodingPlanQuotaInput;
  codingPlanQuotaLoading?: boolean;
  /** 多供应商额度列表（共享会话）；空则回退 codingPlanQuota 单条。 */
  quotaEntries?: SessionOverviewQuotaEntryInput[];
  /** 与设置 usageShowRemaining 对齐：true 显示剩余，false 显示已用。 */
  usageShowRemaining: boolean;
  /** 注入时钟便于测试;运行中时长以该值减 processingStartedAt。 */
  nowMs: number;
};

export type SessionOverviewViewModel = {
  sessionId: string | null;
  engine: EngineType | null;
  model: string | null;
  /** 引擎/供应商展示行：多供应商时为「Claude · A · Claude · B」 */
  engineLine: string | null;
  workspaceLabel: string | null;
  workspacePath: string | null;
  sessionDiskPath: string | null;
  status: SessionOverviewStatus;
  durationMs: number | null;
  messageCount: number;
  turnCount: number;
  contextUsedPercent: number | null;
  contextUsedTokens: number | null;
  modelContextWindow: number | null;
  /** 兼容单条访问；等同 quotaEntries[0]?.quota 或空 none */
  quota: SessionOverviewQuotaView;
  /** 供应商额度列表（共享会话可多条） */
  quotaEntries: SessionOverviewQuotaEntryView[];
  hasAnyContent: boolean;
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function resolveWorkspaceLabel(
  workspaceName: string | null,
  workspacePath: string | null,
): string | null {
  if (workspaceName && workspaceName.trim().length > 0) {
    return workspaceName;
  }
  if (!workspacePath) {
    return null;
  }
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

function resolveStatus(input: SessionOverviewInput): SessionOverviewStatus {
  if (input.threadStatus?.isContextCompacting) {
    return "compacting";
  }
  return input.isProcessing ? "running" : "idle";
}

function resolveDurationMs(
  input: SessionOverviewInput,
  status: SessionOverviewStatus,
): number | null {
  const startedAt = input.threadStatus?.processingStartedAt;
  if (status !== "idle" && typeof startedAt === "number" && startedAt > 0) {
    return Math.max(0, input.nowMs - startedAt);
  }
  const lastDuration = input.threadStatus?.lastDurationMs;
  if (status === "idle" && typeof lastDuration === "number" && lastDuration > 0) {
    return lastDuration;
  }
  return null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildQuotaWindow(
  id: "primary" | "secondary",
  window: RateLimitWindow | null | undefined,
  showRemaining: boolean,
): SessionOverviewQuotaWindowView | null {
  if (!window || typeof window.usedPercent !== "number") {
    return null;
  }
  const usedPercent = clampPercent(window.usedPercent);
  const displayPercent = showRemaining
    ? clampPercent(100 - usedPercent)
    : usedPercent;
  return {
    id,
    label: formatRateLimitWindowLabel(window.windowDurationMins),
    displayPercent,
    usedPercent,
    resetsAt:
      typeof window.resetsAt === "number" && Number.isFinite(window.resetsAt)
        ? window.resetsAt
        : null,
  };
}

function parseResetAtToMs(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function codingPlanWindowLabel(id: string): string {
  if (id === "five_hour" || id === "primary") {
    return "5小时";
  }
  if (id === "weekly_limit" || id === "secondary" || id === "seven_day") {
    return "7天";
  }
  return id;
}

function buildCodingPlanWindows(
  codingPlan: NonNullable<CodingPlanQuotaInput>,
  showRemaining: boolean,
): SessionOverviewQuotaWindowView[] {
  return codingPlan.windows.map((window) => {
    const usedPercent = clampPercent(window.usedPercent);
    const remainingPercent = clampPercent(
      typeof window.remainingPercent === "number"
        ? window.remainingPercent
        : 100 - usedPercent,
    );
    return {
      id: window.id,
      label: codingPlanWindowLabel(window.id),
      displayPercent: showRemaining ? remainingPercent : usedPercent,
      usedPercent,
      resetsAt: parseResetAtToMs(window.resetsAt ?? null),
    };
  });
}

/** 金额字符串保留 2 位小数（95878.280174 → 95878.28） */
export function formatMoneyTwoDecimals(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "0.00";
  }
  const n = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(n)) {
    return trimmed;
  }
  return n.toFixed(2);
}

/**
 * 供应商展示：`{真实站点 origin} {source}`（空格分隔，两边都是变量）
 * 例：`https://relay.example.com sub2api` / `https://ai.example.com new_api`
 * 禁止写死「站点接口」/「sub2api」文案，禁止用 `+` 连接。
 */
export function formatRelayProviderLabel(
  source: string,
  siteOrigin?: string | null,
): string {
  const kind = source.trim();
  const origin = (siteOrigin ?? "").trim().replace(/\/+$/, "");
  if (origin && kind) {
    return `${origin} ${kind}`;
  }
  if (origin) {
    return origin;
  }
  return kind || source;
}

function formatBalanceCredits(
  balance: CodingPlanBalanceInput | null | undefined,
): { hasCredits: boolean; creditsBalance: string | null } {
  const items = balance?.items ?? [];
  if (items.length === 0) {
    return { hasCredits: false, creditsBalance: null };
  }
  const parts = items
    .map((item) => {
      const currency = normalizeOptionalText(item.currency) ?? "UNKNOWN";
      const totalRaw = normalizeOptionalText(item.totalBalance) ?? "0";
      const total = formatMoneyTwoDecimals(totalRaw);
      return `${currency} ${total}`;
    })
    .filter(Boolean);
  if (parts.length === 0) {
    return { hasCredits: false, creditsBalance: null };
  }
  return {
    hasCredits: true,
    creditsBalance: parts.join(" · "),
  };
}

function hasUsageSummaryPayload(
  summary: CodingPlanUsageSummaryInput | null | undefined,
): boolean {
  if (!summary) {
    return false;
  }
  return (
    summary.totalRequests != null ||
    (typeof summary.totalActualCost === "string" &&
      summary.totalActualCost.trim().length > 0) ||
    summary.totalInputTokens != null ||
    summary.totalOutputTokens != null ||
    summary.totalTokens != null ||
    summary.averageDurationMs != null
  );
}

/** 供应商额度成功：有百分比窗口、余额条目或 Sub2API 用量摘要 */
function hasProviderQuotaPayload(
  codingPlan: NonNullable<CodingPlanQuotaInput>,
): boolean {
  return (
    codingPlan.windows.length > 0 ||
    (codingPlan.balance?.items?.length ?? 0) > 0 ||
    hasUsageSummaryPayload(codingPlan.usageSummary)
  );
}

function emptyQuotaView(
  partial: Partial<SessionOverviewQuotaView> &
    Pick<SessionOverviewQuotaView, "source" | "showRemaining">,
): SessionOverviewQuotaView {
  return {
    providerLabel: null,
    planType: null,
    windows: [],
    creditsBalance: null,
    creditsUnlimited: false,
    hasCredits: false,
    usageSummary: null,
    error: null,
    loading: false,
    ...partial,
  };
}

function mapUsageSummary(
  summary: CodingPlanUsageSummaryInput | null | undefined,
): SessionOverviewUsageSummaryView | null {
  if (!hasUsageSummaryPayload(summary)) {
    return null;
  }
  const costRaw = normalizeOptionalText(summary?.totalActualCost ?? null);
  return {
    totalRequests:
      typeof summary?.totalRequests === "number" ? summary.totalRequests : null,
    totalActualCost: costRaw ? formatMoneyTwoDecimals(costRaw) : null,
    totalInputTokens:
      typeof summary?.totalInputTokens === "number"
        ? summary.totalInputTokens
        : null,
    totalOutputTokens:
      typeof summary?.totalOutputTokens === "number"
        ? summary.totalOutputTokens
        : null,
    totalTokens:
      typeof summary?.totalTokens === "number" ? summary.totalTokens : null,
    averageDurationMs:
      typeof summary?.averageDurationMs === "number"
        ? summary.averageDurationMs
        : null,
  };
}

function buildProviderCodingPlanQuota(
  codingPlan: NonNullable<CodingPlanQuotaInput>,
  usageShowRemaining: boolean,
): SessionOverviewQuotaView {
  const credits = formatBalanceCredits(codingPlan.balance ?? null);
  return {
    source: "coding_plan",
    providerLabel: formatRelayProviderLabel(
      codingPlan.source,
      codingPlan.siteOrigin,
    ),
    showRemaining: usageShowRemaining,
    planType: normalizeOptionalText(codingPlan.planLabel ?? null),
    windows: buildCodingPlanWindows(codingPlan, usageShowRemaining),
    creditsBalance: credits.creditsBalance,
    creditsUnlimited: false,
    hasCredits: credits.hasCredits,
    usageSummary: mapUsageSummary(codingPlan.usageSummary),
    error: null,
    loading: false,
  };
}

function buildOfficialCliQuota(
  rateLimits: RateLimitSnapshot | null,
  usageShowRemaining: boolean,
  providerLabel: string,
): SessionOverviewQuotaView {
  const windows: SessionOverviewQuotaWindowView[] = [];
  const primary = buildQuotaWindow(
    "primary",
    rateLimits?.primary,
    usageShowRemaining,
  );
  const secondary = buildQuotaWindow(
    "secondary",
    rateLimits?.secondary,
    usageShowRemaining,
  );
  if (primary) {
    windows.push(primary);
  }
  if (secondary) {
    windows.push(secondary);
  }
  const credits = rateLimits?.credits ?? null;
  const creditsBalance = normalizeOptionalText(credits?.balance ?? null);
  const creditsUnlimited = credits?.unlimited === true;
  const hasCredits =
    credits?.hasCredits === true || creditsUnlimited || creditsBalance != null;

  return {
    source: "official_cli",
    providerLabel,
    showRemaining: usageShowRemaining,
    planType: normalizeOptionalText(rateLimits?.planType ?? null),
    windows,
    creditsBalance,
    creditsUnlimited,
    hasCredits,
    usageSummary: null,
    error: null,
    loading: false,
  };
}

/**
 * 路由合并（对齐规则）：
 * - coding_plan 成功且有 windows 或 balance → 用供应商 API / 余额
 * - official_cli / source=codex → account rateLimits
 * - none → 隐藏
 * - 其余 → empty / unsupported / error
 */
export function buildSessionOverviewQuota(
  engine: EngineType | null,
  rateLimits: RateLimitSnapshot | null,
  usageShowRemaining: boolean,
  codingPlanQuota: CodingPlanQuotaInput = null,
  codingPlanQuotaLoading = false,
): SessionOverviewQuotaView {
  if (engine == null) {
    return emptyQuotaView({
      source: "none",
      showRemaining: usageShowRemaining,
      loading: codingPlanQuotaLoading,
    });
  }

  if (codingPlanQuotaLoading && !codingPlanQuota) {
    return emptyQuotaView({
      source: "coding_plan",
      providerLabel: engine,
      showRemaining: usageShowRemaining,
      loading: true,
    });
  }

  // 供应商额度优先（百分比 windows 或余额 balance；含 Codex/Claude 配 DeepSeek/MiniMax）
  if (
    codingPlanQuota &&
    codingPlanQuota.success &&
    hasProviderQuotaPayload(codingPlanQuota) &&
    codingPlanQuota.source !== "codex" &&
    codingPlanQuota.source !== "official_cli" &&
    codingPlanQuota.source !== "none"
  ) {
    return buildProviderCodingPlanQuota(codingPlanQuota, usageShowRemaining);
  }

  // 官方 runtime：Codex account/rateLimits
  if (
    codingPlanQuota?.source === "codex" ||
    codingPlanQuota?.source === "official_cli" ||
    (engine === "codex" &&
      (!codingPlanQuota ||
        codingPlanQuota.source === "codex" ||
        codingPlanQuota.source === "official_cli"))
  ) {
    return buildOfficialCliQuota(rateLimits, usageShowRemaining, "codex");
  }

  // 官方 Claude 等：无 plan 块
  if (codingPlanQuota?.source === "none") {
    return emptyQuotaView({
      source: "none",
      providerLabel: engine,
      showRemaining: usageShowRemaining,
    });
  }

  if (!codingPlanQuota) {
    // 无 coding plan 响应时：仅 codex 回退 rateLimits
    if (engine === "codex") {
      return buildOfficialCliQuota(rateLimits, usageShowRemaining, "codex");
    }
    return emptyQuotaView({
      source: "empty",
      providerLabel: engine,
      showRemaining: usageShowRemaining,
    });
  }

  if (
    codingPlanQuota.source === "unsupported" ||
    codingPlanQuota.source === "empty_credentials" ||
    codingPlanQuota.source === "empty"
  ) {
    return emptyQuotaView({
      source:
        codingPlanQuota.source === "unsupported" ? "unsupported" : "empty",
      providerLabel: formatRelayProviderLabel(
        codingPlanQuota.source,
        codingPlanQuota.siteOrigin,
      ),
      showRemaining: usageShowRemaining,
      // unsupported 展示友好 error；empty_credentials 也展示（如缺 key）
      error:
        codingPlanQuota.source === "unsupported" ||
        codingPlanQuota.source === "empty_credentials"
          ? (codingPlanQuota.error ?? null)
          : null,
    });
  }

  // Sub2API / New API 失败：error 已是用户文案；供应商行仍带 origin
  if (!codingPlanQuota.success) {
    return emptyQuotaView({
      source: "error",
      providerLabel: formatRelayProviderLabel(
        codingPlanQuota.source,
        codingPlanQuota.siteOrigin,
      ),
      showRemaining: usageShowRemaining,
      error: codingPlanQuota.error ?? "额度查询失败，请稍后重试",
    });
  }

  // success 但无 windows（官方 runtime 空窗口）
  if (
    codingPlanQuota.source === "codex" ||
    codingPlanQuota.source === "official_cli"
  ) {
    return buildOfficialCliQuota(rateLimits, usageShowRemaining, "codex");
  }

  // success 且无 payload：如 deepseek 空 balance_infos — 仍按 coding_plan 展示，不冒充 official
  return buildProviderCodingPlanQuota(codingPlanQuota, usageShowRemaining);
}

export function buildSessionOverview(
  input: SessionOverviewInput,
): SessionOverviewViewModel {
  const status = resolveStatus(input);
  let messageCount = 0;
  let turnCount = 0;
  for (const item of input.items) {
    if (item.kind !== "message") {
      continue;
    }
    messageCount += 1;
    if (item.role === "user") {
      turnCount += 1;
    }
  }
  const contextUsedPercent =
    typeof input.tokenUsage?.contextUsedPercent === "number"
      ? clampPercent(input.tokenUsage.contextUsedPercent)
      : null;
  const contextUsedTokens =
    typeof input.tokenUsage?.contextUsedTokens === "number"
      ? input.tokenUsage.contextUsedTokens
      : null;
  const modelContextWindow =
    typeof input.tokenUsage?.modelContextWindow === "number"
      ? input.tokenUsage.modelContextWindow
      : null;

  const sessionId = normalizeOptionalText(input.sessionId);
  const workspacePath = normalizeOptionalText(input.workspacePath);
  const sessionDiskPath = normalizeOptionalText(input.sessionDiskPath);
  const workspaceLabel = resolveWorkspaceLabel(
    input.workspaceName,
    workspacePath,
  );
  const durationMs = resolveDurationMs(input, status);

  const entryInputs: SessionOverviewQuotaEntryInput[] =
    input.quotaEntries && input.quotaEntries.length > 0
      ? input.quotaEntries
      : input.engine
        ? [
            {
              key: `${input.engine}::fallback`,
              title: input.engine,
              subtitle: input.model,
              engine: input.engine,
              providerProfileId: null,
              codingPlanQuota: input.codingPlanQuota ?? null,
              codingPlanQuotaLoading: input.codingPlanQuotaLoading === true,
            },
          ]
        : [];

  const quotaEntries: SessionOverviewQuotaEntryView[] = entryInputs.map(
    (entry) => ({
      key: entry.key,
      title: entry.title,
      subtitle: entry.subtitle,
      engine: entry.engine,
      providerProfileId: entry.providerProfileId,
      quota: buildSessionOverviewQuota(
        entry.engine,
        // 官方 Codex 额度是账号级：任一 official 条目可共享 rateLimits
        input.rateLimits,
        input.usageShowRemaining,
        entry.codingPlanQuota,
        entry.codingPlanQuotaLoading === true,
      ),
    }),
  );

  // 仅展示有表面的条目；none/empty 且不 loading 的跳过（官方 Claude）
  const visibleQuotaEntries = quotaEntries.filter((entry) => {
    const q = entry.quota;
    return (
      q.windows.length > 0 ||
      q.hasCredits ||
      q.planType != null ||
      q.loading ||
      q.source === "unsupported" ||
      q.source === "error" ||
      q.source === "official_cli" ||
      q.source === "coding_plan"
    );
  });

  const quota: SessionOverviewQuotaView =
    visibleQuotaEntries[0]?.quota ??
    buildSessionOverviewQuota(
      input.engine,
      input.rateLimits,
      input.usageShowRemaining,
      input.codingPlanQuota ?? null,
      input.codingPlanQuotaLoading === true,
    );

  const engineLine =
    entryInputs.length > 1
      ? entryInputs
          .map((e) =>
            e.subtitle ? `${e.title} · ${e.subtitle}` : e.title,
          )
          .join(" · ")
      : entryInputs.length === 1
        ? entryInputs[0]!.subtitle
          ? `${entryInputs[0]!.title} · ${entryInputs[0]!.subtitle}`
          : entryInputs[0]!.title
        : input.engine
          ? input.model
            ? `${input.engine} · ${input.model}`
            : input.engine
          : input.model;

  const hasQuotaSurface = visibleQuotaEntries.length > 0;

  const hasAnyContent =
    sessionId !== null ||
    input.engine !== null ||
    workspaceLabel !== null ||
    workspacePath !== null ||
    sessionDiskPath !== null ||
    messageCount > 0 ||
    contextUsedPercent !== null ||
    hasQuotaSurface ||
    entryInputs.length > 0;

  return {
    sessionId,
    engine: input.engine,
    model: input.model,
    engineLine,
    workspaceLabel,
    workspacePath,
    sessionDiskPath,
    status,
    durationMs,
    messageCount,
    turnCount,
    contextUsedPercent,
    contextUsedTokens,
    modelContextWindow,
    quota,
    quotaEntries: visibleQuotaEntries,
    hasAnyContent,
  };
}
