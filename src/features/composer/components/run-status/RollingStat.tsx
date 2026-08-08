/**
 * pill 上的 +N / -N 数字滚动：基于 @number-flow/react 的 odometer 位滚动。
 *
 * 注意：
 * - NumberFlow 仅在 **已挂载后 value 变化** 时动画；首次挂载直接显示终值不会滚。
 * - 因此 mount / 目标变化时：先落到上一次可见值（首挂为 0），再在 layout 后切到目标。
 * - respectMotionPreference：系统「减少动态效果」时 NumberFlow 内部会跳过动画。
 * - 需要浏览器支持 CSS mod() / linear() / @property（现代 Chromium / WKWebView 一般可用）。
 */
import { memo, useEffect, useRef, useState } from "react";
import NumberFlow, { continuous } from "@number-flow/react";

/** 略放慢，方便肉眼观察位滚动 */
const DEFAULT_DURATION_MS = 900;

export type RollingStatProps = {
  value: number;
  /** 前缀，如 "+" / "-" */
  prefix?: string;
  className?: string;
  /** 滚动时长（ms），映射到 NumberFlow spin/transform timing */
  durationMs?: number;
  /** 测试与 a11y：固定最终语义值 */
  "data-testid"?: string;
};

export const RollingStat = memo(function RollingStat({
  value,
  prefix = "",
  className,
  durationMs = DEFAULT_DURATION_MS,
  "data-testid": testId,
}: RollingStatProps) {
  // 首挂非 0 时从 0 起滚；后续更新从当前 display 滚到新 value
  const [displayValue, setDisplayValue] = useState(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let outer = 0;
    let inner = 0;

    // 首挂：先确保 0 已 paint，再设目标（触发 NumberFlow 更新动画）
    // 后续：直接在下一帧设目标（display 已是旧值）
    const apply = () => {
      if (!cancelled) {
        setDisplayValue(value);
        mountedRef.current = true;
      }
    };

    if (!mountedRef.current && value === 0) {
      apply();
      return;
    }

    outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(apply);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [value]);

  const timing = {
    duration: Math.max(0, durationMs),
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  } as const;

  return (
    <span
      className={className}
      data-testid={testId}
      data-value={value}
      data-display-value={displayValue}
      aria-label={`${prefix}${value}`}
    >
      <NumberFlow
        value={displayValue}
        prefix={prefix}
        plugins={[continuous]}
        format={{ useGrouping: false, maximumFractionDigits: 0 }}
        transformTiming={timing}
        spinTiming={timing}
        opacityTiming={{
          duration: Math.min(400, durationMs),
          easing: "ease-out",
        }}
        respectMotionPreference
        isolate
        willChange
        className="composer-run-status-rolling-stat"
        style={{
          fontVariantNumeric: "tabular-nums",
          lineHeight: 0.85,
          // 默认量级；过小会把位滚动裁成「瞬间跳变」
          ["--number-flow-mask-height" as string]: "0.25em",
          ["--number-flow-mask-width" as string]: "0.35em",
        }}
      />
    </span>
  );
});
