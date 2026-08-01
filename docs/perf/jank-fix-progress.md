# Parallel Conversation Jank — Fix Progress

> **Lifecycle**：Historical Unfilled Worksheet。空白 metric 不是 current measurement，也不是待办承诺；新采样应生成带 timestamp/version/commit 的 evidence artifact，不回填本表伪造连续性。
> 原始用法：边修边填。每完成一个根因,记录数据。

## 阶段 0:基线(修复前)

- 复现脚本:`bash scripts/perf-reproduce-jank.sh` 30 分钟采样
- 报告文件:`docs/perf/jank-reproduce-report-<timestamp>.txt`
- 关键指标:
  - 切 workspace 响应时间:_____ ms
  - 帧时间 p95:_____ ms
  - 30 分钟 child 进程数:_____
  - Heap 30 分钟增长:_____ MB
  - `ImageBitmap` detached 数:_____

## 阶段 1:P0 — §4 根因 2(优化开关退化)

- [x] Step 1.1 文档化 default value
- [x] Step 1.2 导出 `getActiveRealtimePerfFlags()` debug 入口
- [x] Step 1.3 Settings 面板加 "Reset" 按钮
- [ ] Step 1.4 模块顶层 cache 改 lazy read

数据(修复后):
- 切 workspace 响应:_____ → _____
- 帧时间 p95:_____ → _____

## 阶段 2:P0 — §5 根因 1(Rust child 进程释放缺少 Drop 兜底)

- [x] Step 2.1 `ClaudeSession` 加 `impl Drop`
- [x] Step 2.2 暴露 workspace-level diagnostics command
- [ ] Step 2.3 加后台 reconciler
- [ ] Step 2.4 三平台测试(macOS / Windows / Linux)

数据(修复后):
- 30 分钟 child 进程数:_____ → _____
- 关闭 workspace 30s 后 child 数:_____ → _____

## 阶段 3:P1 — §6 根因 3(progressive reveal 边界扫描成本)

- [x] Step 3.1 `findProgressiveRevealBoundary` 合并正则
- [ ] Step 3.2 `resolveProgressiveRevealValue` useMemo
- [x] Step 3.3 保留短 pending 短路并补 regression
- [ ] Step 3.4 按 profiler 调整长 visible cadence

数据(修复后):
- `findProgressiveRevealBoundary` 扫描路径:6 次 regex pass → 1 次 newline scan
- Markdown 重渲染频率:_____ → _____

## 阶段 4:P1 — §8 根因 5(Home/session 长列表虚拟化)

- [ ] Step 4.1 实测超长 list surface `useVirtualizer`
- [ ] Step 4.2 `backgroundActivityByThread` 懒计算 + LRU
- [ ] Step 4.3 reducer structural sharing
- [ ] Step 4.4 100/200 session 压力测试

数据(修复后):
- 200 session/list DOM 节点数:_____ → _____
- 切 workspace 响应:_____ → _____

## 阶段 5:P2 — §7 根因 4(handlers useMemo)

- [ ] Step 5.1 拆 handlers 成 3 组
- [ ] Step 5.2 基础设施 callback 稳定化
- [ ] Step 5.3 30s 长 turn 压测

数据(修复后):
- handlers useMemo rebuild 次数:_____ → _____

## 阶段 6:P2 — §9 根因 7(timer 注册分散且缺 idle scheduling)

- [ ] Step 6.1 统一 timer 注册表
- [ ] Step 6.2 lazyResume / sharedSessionSync 单例合并
- [ ] Step 6.3 非紧急 timer 走 idle callback
- [ ] Step 6.4 heartbeat / reconnect jitter

数据(修复后):
- 5 workspace × 3 session timer registry size:_____ → _____
- 输入响应延迟:_____ → _____

## 阶段 7:P2 — §10 根因 6(图片资源)

- [ ] Step 7.1 扩展 `mediaResourceOwners` 跟踪 `convertFileSrc`
- [ ] Step 7.2 `LocalImage` IntersectionObserver
- [ ] Step 7.3 workspace 切换时整组释放
- [ ] Step 7.4 `convertFileSrc` 加 `cacheBust`

数据(修复后):
- 30 分钟 `ImageBitmap` detached 数:_____ → _____
- 切走 workspace 30s 后内存下降:_____ MB

## 最终验收

- [x] `npm run typecheck` pass
- [x] `npm run lint` pass
- [x] focused tests pass(含新增回归测试)
- [ ] `bash scripts/perf-reproduce-jank.sh` 30 分钟采样,所有指标达到 §0 基线目标
- [ ] 三平台测试通过(macOS / Windows / Linux)
- [ ] `npm run perf:realtime:runtime-report` 不退化
- [ ] `npm run perf:long-list:baseline` 不退化
- [ ] `npm run perf:archive-readiness` 不退化

## 备注

每条数据后,标注采样条件:
- workspace 数:_____
- session 数:_____
- long-running turn 数:_____
- 运行时长:_____ 分钟
- 操作系统 + 版本:_____
