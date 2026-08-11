#!/bin/bash
# scripts/perf-reproduce-jank.sh
#
# Reproduce "parallel conversation jank" symptom by sampling host-side
# child process count and webview memory during a long Tauri dev session.
#
# 配套文档:docs/perf/parallel-conversation-jank-handbook.md §1
# 用法:
#   1) 启动 Tauri dev: npm run tauri:dev
#   2) 登录 + 打开 5 个 workspace + 每个跑 2 个 long-running turn
#   3) 在另一个 terminal 跑这个脚本
#   4) 跑完后报告写到 docs/perf/jank-reproduce-report-<timestamp>.txt
#
# 注意:本脚本不在沙盒内实际跑(沙盒没有 Tauri 实例),仅做 host-side 采样。

set -euo pipefail

SAMPLE_INTERVAL_SEC="${SAMPLE_INTERVAL_SEC:-300}"   # 默认 5 分钟
TOTAL_DURATION_MIN="${TOTAL_DURATION_MIN:-30}"       # 默认 30 分钟
OUTPUT_DIR="${OUTPUT_DIR:-docs/perf}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_FILE="$OUTPUT_DIR/jank-reproduce-report-$TIMESTAMP.txt"

mkdir -p "$OUTPUT_DIR"

# 探测宿主平台
OS_NAME="$(uname -s)"
case "$OS_NAME" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *) PLATFORM="unknown" ;;
esac

echo "Reproduce Parallel Conversation Jank" | tee "$REPORT_FILE"
echo "====================================" | tee -a "$REPORT_FILE"
echo "Platform: $PLATFORM ($OS_NAME)" | tee -a "$REPORT_FILE"
echo "Sample interval: ${SAMPLE_INTERVAL_SEC}s" | tee -a "$REPORT_FILE"
echo "Total duration: ${TOTAL_DURATION_MIN} min" | tee -a "$REPORT_FILE"
echo "Output: $REPORT_FILE" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

# 探测 Tauri 进程(以 webview 为锚)
detect_webview_pids() {
  case "$PLATFORM" in
    macos)
      pgrep -f "WebKit\)|WebKit2WebView" 2>/dev/null || echo ""
      ;;
    linux)
      pgrep -f "webkit2\|WebKitWebProcess" 2>/dev/null || echo ""
      ;;
    windows)
      tasklist /FI "IMAGENAME eq msedgewebview2.exe" /NH 2>/dev/null | awk '{print $2}' || echo ""
      ;;
  esac
}

# 探测 claude / codex 子进程
detect_child_pids() {
  case "$PLATFORM" in
    macos|linux)
      pgrep -f "claude-cli\|codex" 2>/dev/null || echo ""
      ;;
    windows)
      tasklist /FI "IMAGENAME eq claude.exe" /NH 2>/dev/null | awk '{print $2}' || echo ""
      tasklist /FI "IMAGENAME eq codex.exe" /NH 2>/dev/null | awk '{print $2}' || echo ""
      ;;
  esac
}

# 探测 webview 内存(MB)
detect_webview_memory_mb() {
  case "$PLATFORM" in
    macos)
      local pids=$(detect_webview_pids)
      if [[ -n "$pids" ]]; then
        ps -o pid,rss -p $pids 2>/dev/null | awk 'NR>1 {sum+=$2} END {printf "%.1f", sum/1024}'
      else
        echo "0"
      fi
      ;;
    linux)
      local pids=$(detect_webview_pids)
      if [[ -n "$pids" ]]; then
        for pid in $pids; do
          cat /proc/$pid/status 2>/dev/null | grep VmRSS | awk '{print $2}' || echo "0"
        done | awk '{sum+=$1} END {printf "%.1f", sum/1024}'
      else
        echo "0"
      fi
      ;;
    windows)
      # Windows:tasklist 输出 KB,需转换
      tasklist /FI "IMAGENAME eq msedgewebview2.exe" /NH 2>/dev/null | awk '{print $5}' | tr -d ',' | awk '{sum+=$1} END {printf "%.1f", sum/1024}'
      ;;
  esac
}

# 探测 OS 负载
detect_load() {
  case "$PLATFORM" in
    macos|linux)
      uptime | awk -F'load average:' '{print $2}' | awk '{print $1, $2, $3}'
      ;;
    windows)
      wmic cpu get loadpercentage /value 2>/dev/null | grep LoadPercentage | awk -F'=' '{print $2}' || echo "N/A"
      ;;
  esac
}

# 主循环
TOTAL_SAMPLES=$(( (TOTAL_DURATION_MIN * 60) / SAMPLE_INTERVAL_SEC ))

printf "%-12s %-20s %-20s %-15s %-15s\n" "elapsed" "claude/codex children" "webview memory MB" "load avg" "timestamp" | tee -a "$REPORT_FILE"
printf "%-12s %-20s %-20s %-15s %-15s\n" "--------" "--------------------" "-----------------" "--------" "---------" | tee -a "$REPORT_FILE"

for i in $(seq 0 $TOTAL_SAMPLES); do
  ELAPSED_MIN=$(( i * SAMPLE_INTERVAL_SEC / 60 ))
  CHILD_PIDS=$(detect_child_pids)
  CHILD_COUNT=$(echo "$CHILD_PIDS" | grep -c . 2>/dev/null || echo "0")
  WEBVIEW_MEM=$(detect_webview_memory_mb)
  LOAD=$(detect_load)
  TIMESTAMP_NOW="$(date +%H:%M:%S)"

  printf "%-12s %-20s %-20s %-15s %-15s\n" \
    "${ELAPSED_MIN}min" \
    "$CHILD_COUNT" \
    "${WEBVIEW_MEM}MB" \
    "$LOAD" \
    "$TIMESTAMP_NOW" | tee -a "$REPORT_FILE"

  # 第一次提示
  if [[ $i -eq 0 ]]; then
    echo "" | tee -a "$REPORT_FILE"
    echo "Hint: 在 webview DevTools console 跑:" | tee -a "$REPORT_FILE"
    echo "  Object.keys(localStorage).filter(k => k.startsWith('doge.perf.'))" | tee -a "$REPORT_FILE"
    echo "  performance.measureUserAgentSpecificMemory().then(r => console.log(r))" | tee -a "$REPORT_FILE"
    echo "" | tee -a "$REPORT_FILE"
  fi

  if [[ $i -lt $TOTAL_SAMPLES ]]; then
    sleep "$SAMPLE_INTERVAL_SEC"
  fi
done

echo "" | tee -a "$REPORT_FILE"
echo "Done. Report: $REPORT_FILE" | tee -a "$REPORT_FILE"

# 简单的告警
FINAL_CHILD_COUNT=$(detect_child_pids | grep -c . 2>/dev/null || echo "0")
if [[ $FINAL_CHILD_COUNT -gt 10 ]]; then
  echo "" | tee -a "$REPORT_FILE"
  echo "⚠️  WARN: $FINAL_CHILD_COUNT child processes after ${TOTAL_DURATION_MIN} min." | tee -a "$REPORT_FILE"
  echo "  这超过了正常的 workspace × 2 阈值,可能命中 handbook §5(Rust child 进程累积)。" | tee -a "$REPORT_FILE"
fi
