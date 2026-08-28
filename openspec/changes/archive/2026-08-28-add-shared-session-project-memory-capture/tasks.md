## 1. Spec

- [x] 1.1 proposal / design / delta specs
- [x] 1.2 `openspec validate add-shared-session-project-memory-capture --strict --no-interactive`

## 2. 输入采集

- [x] 2.1 Shared V2 committed 路径 captureTurnInput + onInputMemoryCaptured
- [x] 2.2 Shared V1 / 非 committed 有 turn id 时 capture

## 3. 完成融合

- [x] 3.1 shared terminal settle 后始终 onAgentMessageCompleted

## 4. Tests

- [x] 4.1 messaging：V2 committed 调用 captureTurnInput(runtimeTurnId)
- [x] 4.2 useAppServerEvents：投影成功后仍调用 onAgentMessageCompleted

## 5. Validate

- [x] 5.1 vitest 相关文件 + openspec validate 通过（typecheck 见交付门禁）
