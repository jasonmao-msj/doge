import {
  type ComponentProps,
  type ReactNode,
  createContext,
  useContext,
} from "react";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatTokenCount } from "@/utils/tokenFormat";

/**
 * Context — 上下文窗口占用指示器。
 *
 * 移植自 ai-elements 的 Context 组件（https://elements.ai-sdk.dev/components/context），
 * 结构与 className 与官方保持一致；差异仅在数据来源：官方依赖 `ai` 的
 * LanguageModelUsage 与 `tokenlens` 在线计价，这里改为由调用方直接传入
 * token 用量与美元成本（项目内由 context-ledger 的 pricing registry 计算）。
 */

const PERCENT_MAX = 100;
const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 2;

export type ContextTokenUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cachedInputTokens?: number | null;
};

export type ContextCostUSD = {
  inputUSD?: number | null;
  outputUSD?: number | null;
  reasoningUSD?: number | null;
  cacheUSD?: number | null;
  totalUSD?: number | null;
};

type ContextSchema = {
  usedTokens: number;
  maxTokens: number;
  /**
   * 显式占用百分比（0-100）。undefined 时按 usedTokens / maxTokens 推导；
   * null 表示占用未知（触发按钮不显示百分比、圆环为空）。
   */
  usedPercent?: number | null;
  usage?: ContextTokenUsage | null;
  costUSD?: ContextCostUSD | null;
};

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export const formatContextTokens = (
  tokens?: number | null,
): string | undefined => {
  if (typeof tokens !== "number" || !Number.isFinite(tokens)) {
    return undefined;
  }
  return formatTokenCount(tokens);
};

export const formatContextPercent = (
  percent?: number | null,
): string | undefined => {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return undefined;
  }
  // 占用百分比超出 [0, 100] 只可能来自脏数据（如累计 usage 被误当快照），
  // 展示层封顶兜底，避免出现 7,179.2% 这类无意义读数。
  const clamped = Math.min(Math.max(percent, 0), PERCENT_MAX);
  return percentFormatter.format(clamped / PERCENT_MAX);
};

export const formatContextCostUSD = (
  costUSD?: number | null,
): string | undefined => {
  if (typeof costUSD !== "number" || !Number.isFinite(costUSD)) {
    return undefined;
  }
  return currencyFormatter.format(costUSD);
};

const ContextContext = createContext<ContextSchema | null>(null);

const useContextValue = () => {
  const context = useContext(ContextContext);

  if (!context) {
    throw new Error("Context components must be used within Context");
  }

  return context;
};

const resolveUsedPercent = (context: ContextSchema): number | null => {
  if (context.usedPercent === null) {
    return null;
  }
  if (
    typeof context.usedPercent === "number" &&
    Number.isFinite(context.usedPercent)
  ) {
    return context.usedPercent;
  }
  if (context.maxTokens > 0) {
    return (context.usedTokens / context.maxTokens) * PERCENT_MAX;
  }
  return null;
};

export type ContextProps = ComponentProps<typeof HoverCard> & ContextSchema;

export const Context = ({
  usedTokens,
  maxTokens,
  usedPercent,
  usage,
  costUSD,
  ...props
}: ContextProps) => (
  <ContextContext.Provider
    value={{
      usedTokens,
      maxTokens,
      usedPercent,
      usage,
      costUSD,
    }}
  >
    <HoverCard openDelay={300} closeDelay={100} {...props} />
  </ContextContext.Provider>
);

export type ContextUsageIconProps = ComponentProps<"svg"> & {
  usedPercent: number | null;
};

export const ContextUsageIcon = ({
  usedPercent,
  ...props
}: ContextUsageIconProps) => {
  const circumference = 2 * Math.PI * ICON_RADIUS;
  const usedRatio =
    usedPercent === null
      ? 0
      : Math.min(Math.max(usedPercent / PERCENT_MAX, 0), 1);
  const dashOffset = circumference * (1 - usedRatio);

  return (
    <svg
      aria-label="Model context usage"
      height="20"
      role="img"
      style={{ color: "currentcolor" }}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width="20"
      {...props}
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.7"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transformOrigin: "center", transform: "rotate(-90deg)" }}
      />
    </svg>
  );
};

export type ContextTriggerProps = ComponentProps<typeof Button>;

export const ContextTrigger = ({ children, ...props }: ContextTriggerProps) => {
  const context = useContextValue();
  const usedPercent = resolveUsedPercent(context);
  const renderedPercent = formatContextPercent(usedPercent);

  return (
    <HoverCardTrigger asChild>
      {children ?? (
        <Button type="button" variant="ghost" {...props}>
          {renderedPercent ? (
            <span className="font-medium text-muted-foreground">
              {renderedPercent}
            </span>
          ) : null}
          <ContextUsageIcon usedPercent={usedPercent} />
        </Button>
      )}
    </HoverCardTrigger>
  );
};

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export const ContextContent = ({
  className,
  ...props
}: ContextContentProps) => (
  <HoverCardContent
    className={cn("min-w-60 divide-y overflow-hidden p-0", className)}
    {...props}
  />
);

export type ContextContentHeaderProps = ComponentProps<"div">;

export const ContextContentHeader = ({
  children,
  className,
  ...props
}: ContextContentHeaderProps) => {
  const context = useContextValue();
  const usedPercent = resolveUsedPercent(context);
  const displayPct = formatContextPercent(usedPercent);
  const used = formatContextTokens(context.usedTokens);
  const total = formatContextTokens(context.maxTokens);

  return (
    <div className={cn("w-full space-y-2 p-3", className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-3 text-xs">
            <p>{displayPct}</p>
            <p className="font-mono text-muted-foreground">
              {used} / {total}
            </p>
          </div>
          <div className="space-y-2">
            <Progress
              className="bg-muted"
              value={Math.min(Math.max(usedPercent ?? 0, 0), PERCENT_MAX)}
            />
          </div>
        </>
      )}
    </div>
  );
};

export type ContextContentBodyProps = ComponentProps<"div">;

export const ContextContentBody = ({
  children,
  className,
  ...props
}: ContextContentBodyProps) => (
  <div className={cn("w-full p-3", className)} {...props}>
    {children}
  </div>
);

export type ContextContentFooterProps = ComponentProps<"div">;

export const ContextContentFooter = ({
  children,
  className,
  ...props
}: ContextContentFooterProps) => {
  const { costUSD } = useContextValue();
  const totalCost = formatContextCostUSD(costUSD?.totalUSD ?? 0);

  return (
    <div
      className={cn(
        "flex w-full items-center justify-between gap-3 bg-secondary p-3 text-xs",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <span className="text-muted-foreground">Total cost</span>
          <span>{totalCost}</span>
        </>
      )}
    </div>
  );
};

type ContextUsageRowProps = ComponentProps<"div"> & {
  label: ReactNode;
  tokens?: number | null;
  rowCostUSD?: number | null;
};

const ContextUsageRow = ({
  label,
  tokens,
  rowCostUSD,
  className,
  ...props
}: ContextUsageRowProps) => {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return null;
  }

  return (
    <div
      className={cn("flex items-center justify-between text-xs", className)}
      {...props}
    >
      <span className="text-muted-foreground">{label}</span>
      <TokensWithCost costText={formatContextCostUSD(rowCostUSD)} tokens={tokens} />
    </div>
  );
};

type ContextUsageProps = ComponentProps<"div"> & { label?: ReactNode };

export type ContextInputUsageProps = ContextUsageProps;

export const ContextInputUsage = ({
  children,
  label = "Input",
  ...props
}: ContextInputUsageProps) => {
  const { usage, costUSD } = useContextValue();

  if (children) {
    return <>{children}</>;
  }

  return (
    <ContextUsageRow
      label={label}
      tokens={usage?.inputTokens}
      rowCostUSD={costUSD?.inputUSD}
      {...props}
    />
  );
};

export type ContextOutputUsageProps = ContextUsageProps;

export const ContextOutputUsage = ({
  children,
  label = "Output",
  ...props
}: ContextOutputUsageProps) => {
  const { usage, costUSD } = useContextValue();

  if (children) {
    return <>{children}</>;
  }

  return (
    <ContextUsageRow
      label={label}
      tokens={usage?.outputTokens}
      rowCostUSD={costUSD?.outputUSD}
      {...props}
    />
  );
};

export type ContextReasoningUsageProps = ContextUsageProps;

export const ContextReasoningUsage = ({
  children,
  label = "Reasoning",
  ...props
}: ContextReasoningUsageProps) => {
  const { usage, costUSD } = useContextValue();

  if (children) {
    return <>{children}</>;
  }

  return (
    <ContextUsageRow
      label={label}
      tokens={usage?.reasoningTokens}
      rowCostUSD={costUSD?.reasoningUSD}
      {...props}
    />
  );
};

export type ContextCacheUsageProps = ContextUsageProps;

export const ContextCacheUsage = ({
  children,
  label = "Cache",
  ...props
}: ContextCacheUsageProps) => {
  const { usage, costUSD } = useContextValue();

  if (children) {
    return <>{children}</>;
  }

  return (
    <ContextUsageRow
      label={label}
      tokens={usage?.cachedInputTokens}
      rowCostUSD={costUSD?.cacheUSD}
      {...props}
    />
  );
};

const TokensWithCost = ({
  tokens,
  costText,
}: {
  tokens?: number | null;
  costText?: string;
}) => (
  <span>
    {typeof tokens === "number" && Number.isFinite(tokens)
      ? formatTokenCount(tokens)
      : "—"}
    {costText ? (
      <span className="ml-2 text-muted-foreground">• {costText}</span>
    ) : null}
  </span>
);
