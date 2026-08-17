import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import { useTranslation } from "react-i18next";

import type { ThreadSummary } from "../../../types";
import type { ProviderContinuationSourceExcerpt } from "./providerContinuationSourceExcerpt";

function engineLabel(engine: ThreadSummary["engineSource"]): string {
  switch (engine) {
    case "codex":
      return "Codex";
    case "kimi":
      return "Kimi";
    case "gemini":
      return "Gemini";
    case "opencode":
      return "OpenCode";
    case "claude":
    default:
      return "Claude";
  }
}

function providerLabel(
  thread: ThreadSummary | null,
  localProviderLabel: string,
): string {
  return (
    thread?.providerProfileName?.trim() ||
    thread?.providerProfileId?.trim() ||
    localProviderLabel
  );
}

function inferSourceEngine(thread: ThreadSummary): ThreadSummary["engineSource"] {
  const sourceSessionId = thread.sourceSessionId?.trim().toLowerCase() ?? "";
  if (sourceSessionId.startsWith("codex:")) {
    return "codex";
  }
  if (sourceSessionId.startsWith("kimi:")) {
    return "kimi";
  }
  if (sourceSessionId.startsWith("gemini:")) {
    return "gemini";
  }
  if (sourceSessionId.startsWith("opencode:")) {
    return "opencode";
  }
  return "claude";
}

export function ProviderContinuationContextCard({
  thread,
  source,
  sourceExcerpt,
  onOpenSource,
}: {
  thread: ThreadSummary;
  source: ThreadSummary | null;
  sourceExcerpt: ProviderContinuationSourceExcerpt | null;
  onOpenSource: (() => void) | null;
}) {
  const { t } = useTranslation();
  const sourceUnavailableLabel = t(
    "threads.providerContinuationSourceUnavailable",
    { defaultValue: "来源会话已不可用" },
  );
  const localProviderLabel = t("providers.localConfig", {
    defaultValue: "本地配置",
  });
  const openSourceLabel = t("threads.providerContinuationOpenSourceTitle", {
    defaultValue: "查看来源会话",
  });
  const sourceExcerptUnavailableLabel = t(
    "threads.providerContinuationSourceExcerptUnavailable",
    { defaultValue: "来源内容暂无可用摘录" },
  );
  return (
    <details
      className="provider-continuation-context-card group sticky top-[calc(var(--main-topbar-height)+12px)] z-10 mx-auto mt-3 w-[min(920px,calc(100%-32px))] rounded-lg border border-border/60 bg-muted text-sm shadow-sm"
      aria-label={t("threads.providerContinuationContextAriaLabel", {
        defaultValue: "Provider 续接上下文",
      })}
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden
        />
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <GitBranch className="size-3.5" aria-hidden />
        </span>
        <strong className="shrink-0 text-xs">
          {t("threads.providerContinuation", {
            defaultValue: "Provider 续接",
          })}
        </strong>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {engineLabel(source?.engineSource ?? inferSourceEngine(thread))} ·{" "}
          {source
            ? providerLabel(source, localProviderLabel)
            : thread.sourceProviderProfileId?.trim() ||
              t("threads.providerContinuationSourceProvider", {
                defaultValue: "来源 Provider",
              })}
          {" "}
          <ArrowRight className="inline size-3.5 align-text-bottom" aria-hidden />
          {" "}
          {engineLabel(thread.engineSource)} ·{" "}
          {providerLabel(thread, localProviderLabel)}
        </span>
      </summary>
      <div className="border-t border-border/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {t("threads.providerContinuationSourceLabel", {
              defaultValue: "来源：{{source}}",
              source: source?.name ?? sourceUnavailableLabel,
            })}
          </p>
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50"
            onClick={onOpenSource ?? undefined}
            disabled={!onOpenSource}
            aria-label={openSourceLabel}
            title={onOpenSource ? openSourceLabel : sourceUnavailableLabel}
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
        </div>
        {source ? (
          sourceExcerpt ? (
            <div className="mt-2 grid gap-2 rounded-md bg-background/35 px-2.5 py-2">
              {sourceExcerpt.userText ? (
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t("messages.userMessage", { defaultValue: "你" })}
                  </span>
                  <p
                    className="line-clamp-2 min-w-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90"
                  >
                    {sourceExcerpt.userText}
                  </p>
                </div>
              ) : null}
              {sourceExcerpt.assistantText ? (
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t("messages.assistantMessage", {
                      defaultValue: "助手",
                    })}
                  </span>
                  <p
                    className="line-clamp-3 min-w-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90"
                  >
                    {sourceExcerpt.assistantText}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {sourceExcerptUnavailableLabel}
            </p>
          )
        ) : null}
      </div>
    </details>
  );
}
