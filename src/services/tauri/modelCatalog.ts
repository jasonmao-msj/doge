import { invoke } from "@tauri-apps/api/core";
import { traceStartupCommand, type StartupWorkspaceScope } from "../../features/startup-orchestration/utils/startupTrace";

function workspaceScope(workspaceId: string): StartupWorkspaceScope {
  return { workspaceId };
}

function traceStartupInvoke<T>(
  commandLabel: string,
  scope: StartupWorkspaceScope,
  run: () => Promise<T>,
) {
  return traceStartupCommand(commandLabel, scope, run);
}

export async function getModelList(workspaceId: string) {
  return traceStartupInvoke("model_list", workspaceScope(workspaceId), () =>
    invoke<{
      data?: Record<string, unknown>[];
      result?: { data?: Record<string, unknown>[]; [key: string]: unknown };
      [key: string]: unknown;
    }>("model_list", { workspaceId }),
  );
}

export async function discoverCodexModels(
  workspaceId: string,
  providerProfileId?: string | null,
) {
  const normalizedProviderProfileId = providerProfileId?.trim();
  return invoke<{
    data?: Record<string, unknown>[];
    result?: { data?: Record<string, unknown>[]; [key: string]: unknown };
    [key: string]: unknown;
  }>("discover_codex_models", {
    workspaceId,
    providerProfileId: normalizedProviderProfileId || null,
  });
}

export async function generateRunMetadata(workspaceId: string, prompt: string) {
  return invoke<{ title: string; worktreeName: string }>("generate_run_metadata", {
    workspaceId,
    prompt,
  });
}

export async function getCollaborationModes(workspaceId: string) {
  return traceStartupInvoke("collaboration_mode_list", workspaceScope(workspaceId), () =>
    invoke<{
      data?: Record<string, unknown>[];
      result?: { data?: Record<string, unknown>[]; [key: string]: unknown };
      [key: string]: unknown;
    }>("collaboration_mode_list", { workspaceId }),
  );
}

export async function getAccountRateLimits(workspaceId: string) {
  return invoke<{
    rateLimits?: unknown;
    rate_limits?: unknown;
    result?: {
      rateLimits?: unknown;
      rate_limits?: unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>("account_rate_limits", { workspaceId });
}

/** Coding Plan 双窗口额度（对齐 CC Switch：Kimi / MiniMax / 智谱） */
export type CodingPlanQuotaWindow = {
  id: string;
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: string | null;
};

/** 余额型供应商条目（DeepSeek GET /user/balance） */
export type CodingPlanBalanceItem = {
  currency: string;
  totalBalance: string;
  grantedBalance?: string | null;
  toppedUpBalance?: string | null;
};

export type CodingPlanBalanceSnapshot = {
  isAvailable: boolean;
  items: CodingPlanBalanceItem[];
};

/** Sub2API 等中转站用量摘要（配额 HUD 多行） */
export type CodingPlanUsageSummary = {
  totalRequests?: number | null;
  /** 已格式化金额，如 `0.014363` */
  totalActualCost?: string | null;
  totalInputTokens?: number | null;
  totalOutputTokens?: number | null;
  totalTokens?: number | null;
  averageDurationMs?: number | null;
};

export type CodingPlanQuotaSnapshot = {
  source: string;
  /** api | cli | official_runtime */
  via?: string | null;
  success: boolean;
  error?: string | null;
  planLabel?: string | null;
  windows: CodingPlanQuotaWindow[];
  /** 余额型额度；百分比供应商为 null/省略 */
  balance?: CodingPlanBalanceSnapshot | null;
  /** Sub2API 用量摘要 */
  usageSummary?: CodingPlanUsageSummary | null;
  /** 中转 origin，如 `https://relay.example.com`；UI 展示 `{siteOrigin}+sub2api` */
  siteOrigin?: string | null;
  queriedAt: number;
};

export async function getCodingPlanQuota(
  engine: string,
  providerProfileId?: string | null,
): Promise<CodingPlanQuotaSnapshot> {
  return invoke<CodingPlanQuotaSnapshot>("get_coding_plan_quota", {
    engine,
    providerProfileId: providerProfileId ?? null,
  });
}

export async function getAccountInfo(workspaceId: string) {
  return invoke<Record<string, unknown> | null>("account_read", {
    workspaceId,
  });
}

export async function runCodexLogin(workspaceId: string) {
  return invoke<{ output: string }>("codex_login", { workspaceId });
}

export async function cancelCodexLogin(workspaceId: string) {
  return invoke<{ canceled: boolean }>("codex_login_cancel", { workspaceId });
}
