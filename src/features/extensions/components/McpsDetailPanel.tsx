import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import X from "lucide-react/dist/esm/icons/x";

import { cn } from "@/lib/utils";

import type { McpConfigRow, McpServerRow } from "../utils/mcpInventory";
import { McpsToggleSwitch } from "./McpsToggleSwitch";

// 一条属性行：左 muted 标签、右值。沿用 SkillDetailPanel 的 PropRow 约定。
function PropRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <dt className="flex items-center gap-1 text-oai-gray-500 dark:text-oai-gray-400">
        {label}
      </dt>
      <dd className="text-right font-medium tabular-nums text-oai-black dark:text-white">
        {children}
      </dd>
    </div>
  );
}

type McpsDetailPanelProps = {
  row: McpServerRow | null;
  engineLabel: string;
  pendingRowId: string | null;
  onToggleConfig: (row: McpConfigRow, enabled: boolean) => void;
  onClose: () => void;
};

export function McpsDetailPanel({ row, engineLabel, pendingRowId, onToggleConfig, onClose }: McpsDetailPanelProps) {
  return (
    <AnimatePresence>
      {row ? (
        <McpsDetailPanelInner
          key={row.id}
          row={row}
          engineLabel={engineLabel}
          pendingRowId={pendingRowId}
          onToggleConfig={onToggleConfig}
          onClose={onClose}
        />
      ) : null}
    </AnimatePresence>
  );
}

function McpsDetailPanelInner({ row, engineLabel, pendingRowId, onToggleConfig, onClose }: McpsDetailPanelProps & { row: McpServerRow }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // 面板内部点击不关；行点击由行自身处理（选中/切换），避免面板闪烁。
      if (panelRef.current?.contains(target)) return;
      if (target.closest('[data-mcp-row="1"]')) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [onClose]);

  const transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 320, damping: 30, mass: 0.7 };

  const sourceLabel =
    row.kind === "config"
      ? row.source === "claude_json"
        ? t("extensions.mcps.detail.sourceClaude")
        : t("extensions.mcps.detail.sourceDoge")
      : t("extensions.mcps.groups.runtime");

  const statusLabel =
    row.kind === "runtime"
      ? (row.authLabel ?? row.statusLabel ?? t("extensions.mcps.badges.statusUnknown"))
      : null;

  return (
    <>
      {/* 移动端背板 —— 桌面端直接覆盖在列表右侧，不压暗列表。 */}
      <motion.div
        className="fixed inset-0 z-20 bg-oai-black/30 backdrop-blur-[2px] lg:hidden"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.15 }}
        onClick={onClose}
        aria-hidden
      />
      <motion.aside
        ref={panelRef}
        role="complementary"
        aria-label={row.name}
        initial={reduceMotion ? false : { opacity: 0, x: 24, scale: 0.98 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.98 }}
        transition={transition}
        className={
          "fixed inset-x-3 bottom-3 top-20 z-30 flex flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-[0_24px_60px_-20px_rgba(15,23,42,0.25)] dark:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)] " +
          "lg:inset-auto lg:right-6 lg:top-24 lg:bottom-6 lg:w-[22rem] lg:max-h-[calc(100vh-7.5rem)]"
        }
      >
        <header className="flex items-center gap-3 border-b border-border bg-popover px-5 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-base font-semibold text-oai-black dark:text-white"
              title={row.name}
            >
              {row.name}
              {row.kind === "runtime" && row.builtIn ? (
                <span className="ml-2 inline-flex items-center rounded-full bg-oai-gray-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-oai-gray-600 ring-1 ring-oai-gray-200 dark:bg-oai-gray-800 dark:text-oai-gray-300 dark:ring-oai-gray-700">
                  {t("extensions.mcps.badges.builtIn")}
                </span>
              ) : null}
            </h2>
            <div className="mt-1 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {engineLabel} ·{" "}
              {t(
                row.kind === "config"
                  ? "extensions.mcps.groups.config"
                  : "extensions.mcps.groups.runtime",
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("extensions.mcps.detail.close")}
            className="-mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-oai-gray-500 transition hover:bg-oai-gray-100 hover:text-oai-black focus:outline-none focus:ring-2 focus:ring-oai-gray-400/30 dark:text-oai-gray-400 dark:hover:bg-oai-gray-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-oai-gray-500 dark:text-oai-gray-400">
              {t("extensions.mcps.detail.sectionTitle")}
            </h3>
            <dl className="divide-y divide-oai-gray-200/60 dark:divide-white/[0.06]">
              <PropRow label={t("extensions.mcps.detail.source")}>{sourceLabel}</PropRow>
              {row.kind === "config" ? (
                <PropRow label={t("extensions.mcps.detail.transport")}>
                  {row.transport ?? t("extensions.mcps.detail.transportUnknown")}
                </PropRow>
              ) : null}
              {row.kind === "config" && row.command ? (
                <PropRow label={t("extensions.mcps.detail.command")}>
                  <span className="break-all font-mono text-xs">
                    {t("extensions.mcps.detail.commandMeta", {
                      command: row.command,
                      args: row.argsCount,
                    })}
                  </span>
                </PropRow>
              ) : null}
              {row.kind === "config" && !row.command && row.url ? (
                <PropRow label={t("extensions.mcps.detail.url")}>
                  <span className="break-all font-mono text-xs">{row.url}</span>
                </PropRow>
              ) : null}
              {row.kind === "config" ? (
                <PropRow label={t("extensions.mcps.detail.status")}>
                  <McpsToggleSwitch
                    row={row}
                    pending={pendingRowId === row.id}
                    onToggle={onToggleConfig}
                  />
                </PropRow>
              ) : (
                <PropRow
                  label={t(
                    row.authLabel
                      ? "extensions.mcps.detail.auth"
                      : "extensions.mcps.detail.status",
                  )}
                >
                  {statusLabel}
                </PropRow>
              )}
              {row.kind === "runtime" && row.toolNames.length > 0 ? (
                <PropRow label={t("extensions.mcps.detail.resourcesTemplatesLabel")}>
                  {t("extensions.mcps.detail.resourcesTemplates", {
                    resources: row.resourcesCount,
                    templates: row.templatesCount,
                  })}
                </PropRow>
              ) : null}
            </dl>
          </section>

          {row.kind === "runtime" && row.toolNames.length > 0 ? (
            <section className="mt-6">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-oai-gray-500 dark:text-oai-gray-400">
                {t("extensions.mcps.detail.tools")}
              </h3>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {row.toolNames.map((tool) => (
                  <span
                    key={`${row.id}-${tool}`}
                    className={cn(
                      "rounded-full bg-oai-gray-100 px-2 py-0.5 text-xs text-oai-gray-600",
                      "dark:bg-oai-gray-800 dark:text-oai-gray-300",
                    )}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </motion.aside>
    </>
  );
}
