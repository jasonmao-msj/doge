## 1. Contract & pure helpers

- [x] 1.1 新增 `isSubagentStyleAgentTaskNotification`（及单测：Agent 引号 / 智能体 / 非 SubAgent 摘要）
- [x] 1.2 新增 task-notification → SubagentCard enrich 纯函数（toolUseId 弱匹配、status/result/outputFile/taskId 合并）及单测

## 2. 退役旧卡呈现

- [x] 2.1 `MessageRow`：SubAgent 型 notification 不渲染 `.message-agent-task-card`，不展示 result 独立气泡；仅 notification 时整行可 null
- [x] 2.2 调整 `Messages.rich-content.test.tsx` 等期望：SubAgent 摘要无旧卡；必要时补「非 SubAgent 仍可有卡」样例

## 3. 能力迁移到新卡 / inspector

- [x] 3.1 `SubagentSquadGrid`（或等价）从父 thread items 扫描 notification 并 enrich 卡
- [x] 3.2 `SubagentInspectorDrawer`：无 session 且有 `outputFilePath` 时挂载 `EngineTaskOutputInspector`
- [x] 3.3 补 inspector / enrich 相关 focused test

## 4. 校验与索引

- [x] 4.1 `openspec validate retire-claude-subagent-agent-session-card --strict --no-interactive`
- [x] 4.2 运行 touched 前端 vitest；必要时 typecheck
- [x] 4.3 更新 `openspec/changes/README.md` active 行

## 5. Review 残留修复（多视角复审）

- [x] 5.1 Enrich 数据源：`canvas items ∪ threadItemsByThread[parent]`
- [x] 5.2 toolUseId 安全匹配（禁 call_1/call_12 includes 串卡）
- [x] 5.3 无 toolUseId / 单卡 fallback；description↔summary 匹配
- [x] 5.4 StatusPanel 复用同一 enrich
- [x] 5.5 Timeline 0 高退役 SubAgent notification 行
- [x] 5.6 Inspector：session 与 artifact 可并存（launch 空壳时 artifact 主路径）
- [x] 5.7 回归测：串卡、orphan、description 匹配、merge sources
