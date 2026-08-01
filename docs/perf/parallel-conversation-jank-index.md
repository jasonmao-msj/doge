# Parallel Conversation Jank — Document Index

> **内容类型**：Troubleshooting index
> **生命周期**：historical / reusable diagnosis；对应 P0 修复 change 已归档
> **最后校准**：2026-08-01 · mossx `0.7.14` · HEAD `26f8065a0c`
> 读者：接手「客户端并行对话卡顿」问题的人。先看 TL;DR，再按 §1 顺序读。

## 0. TL;DR

- **现象**:5+ workspace × 2+ long-running turn × 15+ 分钟后,客户端从流畅变卡。切 workspace 响应 200ms+,输入延迟 100ms+,Heap 30 分钟涨 100MB+。
- **根因模型**:7 个 runtime residual 风险叠加的复合症状,不是单点；每条都需要采样确认。
- **第一动作**：先保存 performance report / trace，再通过 Settings Reset 清理当前 registry 的 9 个 boolean flags + schedule tier + tool-output gate，reload 后做对照。
- **完整手册**:`parallel-conversation-jank-handbook.md`(本目录)。
- **执行原则**：七类 residual 是候选模型，不是当前 backlog；先复现、量化、定位，再开 change。

## 1. 文档清单(按读者路径排序)

| 顺序 | 文件 | 用途 | 何时读 |
|---|---|---|---|
| 1 | `parallel-conversation-jank-handbook.md` | 完整诊断 + 修复手册(1012 行) | 上工第一份 |
| 2 | `parallel-conversation-jank-index.md` | 本文件,索引 + 速查 | 入口 |
| 3 | `../../openspec/specs/parallel-conversation-runtime-residuals/spec.md` | 当前主线行为契约 | 写代码 / 测试前 |
| 4 | `../../openspec/changes/archive/2026-06-14-fix-parallel-conversation-runtime-residuals-2026-06/` | 历史修复 proposal/design/tasks/delta | 追溯当时 P0 修复 |
| 5 | `../../.trellis/spec/frontend/parallel-conversation-runtime-residuals.md` | code-level rule | 改相关代码前必读 |
| 6 | `../../scripts/perf-reproduce-jank.sh` | 复现脚本 | 复现 + 验收基线 |
| 7 | `jank-fix-progress.md` | 历史修复进度日志 | 对照旧实验，不续写当前事实 |

原文曾引用 `investigate-parallel-conversation-jank-2026-06` change，但该路径当前不存在；其可保留合同已进入 main spec，实施证据在上表 archive change。此处显式记录迁移，避免制造断链又不抹掉来源。

## 2. 7 条根因速查

| # | 根因 | 影响层 | 优先级 | 修复章节 | 测试位置 |
|---|---|---|---|---|---|
| 1 | Rust child 进程释放缺少 Drop 兜底 | OS / Tokio | P0 | handbook §5 | `src-tauri/src/engine/claude/tests_core.rs` |
| 2 | 优化开关可退化且缺自检/重置 | 全局放大 | P0 | handbook §4 | `src/features/threads/utils/realtimePerfFlags.test.ts` |
| 3 | progressive reveal 边界扫描成本 | CPU 单核 | P1 | handbook §6 | `src/markdown/runtime/LiveMarkdown.test.tsx` |
| 4 | handlers 巨型 useMemo | 内存 churn | P2 | handbook §7 | `src/features/threads/hooks/useThreadEventHandlers.test.ts` |
| 5 | Home/session 长列表未虚拟化 + 全量投影 | 切 workspace 卡 | P1 | handbook §8 | `src/features/home/components/Home.test.tsx` + 当前 virtualization tests |
| 6 | 图片资源释放缺少 viewport/session owner | 内存泄漏 | P2 | handbook §10 | `src/features/messages/components/media/LocalImage.test.tsx` |
| 7 | timer 注册分散且缺 idle scheduling | 主线程延迟 | P2 | handbook §9 | `src/features/threads/hooks/useThreads.integration.test.tsx` 等当前 suites |

## 3. 原始实施顺序（历史；当前不得照单施工）

1. handbook §4 根因 2(P0, 1-2 天)
2. handbook §5 根因 1(P0, 3-5 天)
3. handbook §6 根因 3(P1, 2-3 天)
4. handbook §8 根因 5(P1, 2-3 天)
5. handbook §7 根因 4(P2, 2-3 天)
6. handbook §9 根因 7(P2, 1-2 天)
7. handbook §10 根因 6(P2, 2-3 天)

若当前 evidence 再次命中对应根因，可参考该顺序；否则新建独立 change。每阶段完成后：
- 跑 `npm run typecheck && npm run lint && npm run test` 全套
- 跑 `bash scripts/perf-reproduce-jank.sh` 复现 + 采基线
- 在 `jank-fix-progress.md` 记录数据

## 4. 验收基线

修复前 → 修复后:

| 指标 | 修复前 | 修复后目标 |
|---|---|---|
| 切 workspace 响应 | 200ms+ | < 100ms |
| 帧时间 p95 | 50ms+ | < 30ms |
| 30 分钟 child 进程数 | 50+ | ≤ workspace × 2 |
| Heap 30 分钟增长 | 100MB+ | < 30MB |
| `ImageBitmap` detached 数 | 200+ | < 50 |

## 5. 配套 spec(OpenSpec 行为契约)

- `openspec/specs/conversation-realtime-cpu-stability`(已存在,5 个 Requirement)
- `openspec/specs/conversation-realtime-client-performance`(已存在,3-engine budget)
- `openspec/specs/realtime-event-batching-performance`(已存在,4 个 Requirement)
- `openspec/specs/app-server-event-batching`(已存在,40ms batch + terminal flush)
- `openspec/specs/long-list-virtualization-performance`(已存在,可参考给 §8 实施用)
- 原调查 change 路径当前不存在；可保留合同已同步到 main spec
- `openspec/specs/parallel-conversation-runtime-residuals/spec.md`(主线 spec,已同步 P0 contract + 后续诊断契约)

## 6. 配套 Trellis guide(code-level rule)

- `.trellis/spec/frontend/parallel-conversation-runtime-residuals.md`(新增,7 条 invariant + 5 条 "When Adding" 模式)

## 7. 配套 commit / 提案(参考)

最近 6 个月已落地的相关 P1 提案:

| Commit | 主题 |
|---|---|
| `c27bb18a` | perf(realtime): 降低多会话实时对话CPU峰值并补齐稳定性边界 |
| `7cc4a284` | feat(realtime): 收口事件批处理与文件 I/O 隔离 |
| `25d101a0` | feat(perf): 收口实时输入与前端 prop 链稳定性阶段实现 |
| `a8bd4b24` | feat(perf): 收口客户端性能残余证据 |
| `f7ae0a99` | perf(runtime): 落地 P1 性能预算链路 |
| `c60479d2` | fix(app-shell): prevent redundant re-renders in selected session hooks |
| `96ba5b06` | fix(renderer): 加固客户端渲染稳定性防线 |
| `18de443a` | fix(app): 收口实时线程状态行级订阅 |
| `e1cd9db3` | fix(messages): 收口 Claude 长流式渲染恢复 |
| `bb58e69c` | feat(threads): 优化实时对话客户端性能 |

## 8. 历史提案归宿

- `openspec/changes/archive/2026-06-14-fix-parallel-conversation-runtime-residuals-2026-06/`：P0 修复提案已归档。P1/P2 只有在当前采样重新确认后才进入新 change。
- 验收:`npm run perf:realtime:runtime-report` + `npm run perf:long-list:baseline` + `npm run perf:archive-readiness` 三套 perf gate 确认不退化。
