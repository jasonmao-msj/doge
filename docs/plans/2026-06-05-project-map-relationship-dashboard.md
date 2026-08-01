# Project Map Relationship Dashboard 推进指导（修订版）

> **Lifecycle**：Implemented / Historical Plan。Canonical change 已归档于 `openspec/changes/archive/2026-06-06-add-project-map-relationship-dashboard/`；后续 Project Map 已多轮演进，本文只保留原始 architecture/acceptance reasoning。

## 中文导读

这份推进指导的目标是把 Project Map 从“能展示一些关系”升级为“可靠的关系事实底座”。
核心结论是：`Scan Relationships` 不是一个附加功能，而是 mossx 做 Project Map、Agent 执行面、Browser 现场理解的关键基础设施。
你这次要求的重点我已经完整对齐：
- `Browser Dock trusted observation core` 先暂缓，主线只做 Project Map。
- 扫描按钮必须出现在 Project Map 对应视图。
- 扫描结果落盘到「项目级全局目录平级的 `project-map-relations`」，避免污染源代码树。
- 参考 UA 的有效经验，但不引入 UA 的三方 schema，保留 mossx 自有数据模型。
- 从 storage、scanner、dashboard、impact、Agent Context 一直到 verify 的全部点闭环。

## 1. 这次重构要解决的“实际问题”

目前 Project Map 在关系可用性上存在三类结构性风险：
- 关系事实不确定：依赖 LLM 推断多于文件级静态事实。
- 上下文推荐不稳定：同一 workspace 下 repeated scan 结果会漂移，导致 Agent 读文件路径选择不一致。
- Dashboard 无法交付闭环：存在展示，但没有完整从 scan → persist → consume → stale/repair 的主链路。

这会直接影响：
- 变更影响分析是否可复现。
- Agent 是否知道该先读哪个 test、哪个 spec。
- 后续功能（Diff、Explain、Onboard、Chat、Domain lens）是否有统一事实源。

## 2. 与用户目标的直接映射

你的目标描述我转换为可落地的产品动作：
1. 在 Project Map 视图放一个可触达按钮：`Scan Relationships`。
2. 点击后扫描当前项目文件夹（active workspace root）。
3. 产出关系事实（deterministic facts）：files、relations、imports、bridges、modules、impact。
4. 全部持久化到全局目录：`<app-home>/project-map-relations/<storage-key>/` 下分层目录。
5. 在 Dashboard 展示：
- 选中文件 neighborhood。
- incoming / outgoing / tested_by / specified_by / styled_by / bridge / related。
- impact overlay。
- stale/repair 可视化。
- Agent Read Plan（must-read + related + tests + contracts + risks）。
6. 最终让 Composer / Agent context 能消费这些数据并减少重复扫盘。

## 3. 产品定位与技术定位（Dual-Track）

- `Project Map Relationship`：Deterministic Relationship Substrate（事实层）。
- `Project Map AI`：Semantic Generation Layer（语义层）。

### 为什么必须分离

如果把关系和 AI 语义混在一起：
- 难以追踪来源和可信度。
- LLM 生成结果会覆盖 deterministic facts。
- 不能做稳态 incremental/repair。

### 关键设计口号

- `deterministic-first`：先确保关系事实正确可复现。
- `UI consumes summary`：Dashboard 默认读 summary/index，不一次性读全量文件。
- `repair-before-display`：上游验证修复后再展示。

## 4. UA 借鉴，不引入 UA schema

### UA 的经验保留（值得借鉴）

- pipeline 思路：scan -> normalize -> validate/repair -> dashboardable index。
- multi-skill 拆分：理解、展示、diff、explain、onboard、chat、domain 的职能边界清晰。
- 关系修复与隔离：发现异常关系时先 quarantine，不污染主要视图。
- 命名与上下文：relation evidence 可追踪到 line/path，便于 trace。

### 明确不借鉴（must-not）

- 不引入 UA `knowledge-graph.json` schema。
- 不直接依赖 UA 的 batch job 命名与输出形态。
- 不引入新的三方 graph 持久化框架。

### UA 经典坑位与本项目防线

1. worktree 路径/临时目录写入。=> 全局固定 root + manifest 记录。
2. ignore 不透明。=> 显式 ignore summary。
3. edge direction 混淆。=> 关系类型 + direction 统一枚举。
4. 大图单文件。=> 目录分层 + chunks。
5. dangling edge 污染。=> repair quarantine。
6. stale 无法感知。=> commit/fingerprint + manifest。
7. 关系事实被 AI 覆盖。=> deterministic source 标记。

## 5. 先验数据结构（Draft）

### 5.1 relationship manifest

`ProjectMapRelationshipManifest`
- `schemaVersion`
- `storageKey`
- `workspaceId`
- `workspacePath`
- `projectName`
- `scanRunId`
- `scanStartedAt`
- `scanFinishedAt`
- `generatedAt`
- `scanRoot`
- `gitCommonRoot`
- `gitCommitHash`
- `fileCount`
- `relationCount`
- `ignoredCount`
- `invalidCount`
- `repairIssueCount`
- `isFresh`
- `source: "deterministic-scan"`

### 5.2 扫描文件实体

`ProjectMapScannedFile`
- `id`: canonical stable id。
- `absPath`: absolute path。
- `relPath`: storage root 相对路径。
- `language`: ts/js/rust/json/md/css/sh/other。
- `layer`: frontend/backend/spec/test/style/config/docs/runtime/other。
- `role`: component/service/hook/command/type/spec/test/style/test-helper/module/config/document/other。
- `sizeBytes`, `lineCount`, `contentHash`, `mtime`, `inodeSig`。
- `parseStatus`: parsed / parse-failed / skipped。

### 5.3 关系实体

`ProjectMapFileRelation`
- `id`
- `sourceFileId`
- `targetFileId`
- `type`: imports / exports / tested_by / styled_by / specified_by / documents / configures / contains / bridges_to / related。
- `direction`: forward/backward/bidirectional
- `confidence`: high/medium/low
- `sourceKind`: deterministic
- `evidence`: [{ path, line, snippet, extractorVersion, timestamp }]
- `fingerprint`: relation signature（用于 dedupe）

### 5.4 索引实体

`ProjectMapRelationDashboardIndex`
- `byFileId`: { fileId -> incoming/outgoing/tests/specs/styles/bridges }
- `byType`: { relationType -> relationIds[] }
- `hotspots`: [{ fileId, reason, score, rationale }]
- `moduleMap`: { moduleName -> { fileIds, crossIncoming, crossOutgoing, riskScore } }
- `staleHints`: { reason, impactedFiles[] }

### 5.5 Impact / context pack

- `ImpactSummary`: changedFiles, directImpact, transitiveImpact, unmappedChanges, ignoredChanges, riskFlags。
- `AgentReadPlan`: `mustReadFiles`, `relatedFiles`, `testTargets`, `contracts`, `riskFlags`, `staleReason`, `provenance`。

## 6. 关系类型定义（含方向）

- `imports`：A -> B（A imports B）。
- `exports`：A -> B（A exports symbol used by B，可用于 module boundary）。
- `contains`：module/file-system container。
- `tested_by`：prod -> test。
- `styled_by`：component -> style。
- `specified_by`：code -> spec。
- `documents`：code -> doc。
- `configures`：config -> runtime surface。
- `bridges_to`：frontend service -> tauri command/module。
- `related`：conservative related（fallback low confidence）。

### 关系方向与质量约束

- 若 direction 不确定或解析失败：保留为 `related`。
- 不允许 `tested_by` 逆向默认写入（除 non-prod fallback）。

## 7. 存储布局（层次化）

```text
<app-home>/project-map-relations/<storage-key>/
  manifest.json
  profile.json
  runs/
    latest.json
  scans/
    latest.json
  files/
    manifest.json
    chunks-000.json
    chunks-001.json
  symbols/
    manifest.json
    chunks-000.json
  relations/
    latest.json
    by-file.json
    by-type.json
  modules/
    latest.json
  impact/
    latest.json
  context-packs/
    latest.json
  repair/
    latest.json
```

### 安全约束

- 仅允许写入 `project-map-relations/<storage-key>/` 子树。
- 不允许 `../`, 绝对路径、非法 unicode/控制字符路径。
- Windows 禁用名：`con, prn, aux, nul, com1..com9, lpt1..lpt9`。
- 文件写入必须原子提交；失败回滚保留旧快照。

## 8. 与现有 `project-map` 的关系

- 关系扫描是 sibling-root 的独立 substrate，不改动现有语义 dataset。
- Dashboard 可以从两套数据并行消费，但 deterministic layer 为唯一关系事实来源。
- 现有 `ProjectMapDataset` 的 relation index 可逐步映射为 view model，而非单一真相来源。

## 9. 交付范围（End-to-End）

- Backend
  - scan command
  - persistence service
  - ignore + walker + parse
  - relation builder + validation + repair
- Frontend
  - Project Map 工具条扫描动作
  - scanning 状态与失败提示
  - dashboard 三栏布局（tree / selected / impact）
  - filter / search / hotspots / repair panel
- Agent 互用
  - Agent Read Plan persistence
  - Composer 可消费 context-pack

## 10. 分批推进（建议）

### Batch A：Spec-Plan 收敛
- 你要求的文档统一补齐。

### Batch B：Storage baseline
- `project-map-relations` root、manifest、snapshot、原子写。

### Batch C：Scanner core
- walker、ignore、classify、parser（TS/JS + Rust）、关系构建。

### Batch D：Dashboard MVP
- scan CTA + run state + by-file relationship view。

### Batch E：Impact + read plan
- changed files overlay + must-read plan + hotspot。

### Batch F：Stale & repair
- stale 触发、rebuild 策略、repair 显示。

### Batch G：Composer bridge
- context-pack 输入改造。

### Batch H：闭环校验
- spec 同步、验证清单、归档。

## 11. 你提到“任务更细”的承诺

本轮将 `tasks.md` 拆为更小的执行单元（每个任务一条可独立验收）。
包括：
- 读写边界
- storage schema
- scanner/parser
- validation/repair
- UI 状态机
- impact 算法
- stale 与增量策略
- 异常路径与可观测性
- 回归点与数据迁移

我会在同一 change 下同步细化到你能直接下达开发执行的粒度。

## 12. 关键验收标准（简版）

- 无 active workspace 时：按钮禁用 + 说明。
- 有 workspace 时：按钮可触发扫描。
- 扫描结束后：
  - manifest/scans/files/relations 等关键文件存在。
  - 无崩溃时 stale 与 repair 可读。
  - Dashboard 显示 selected file neighborhood。
  - Agent Read Plan 可落盘并可被 Composer 读取。
- 非确定性关系不得覆盖 deterministic edge。


## 中文+English 术语对照（可直接复用）

- 关系扫描 / Relationship Scan
- 关系事实 / Deterministic Facts
- 关系子图 / Relationship Substrate
- 关系边 / Relation Edge
- 邻域 / Neighborhood
- 邻域视图 / Neighborhood View
- 影响面 / Impact Surface
- 冷启动 / Cold Start
- 关系修复 / Repair
- 陈旧检测 / Staleness
- 增量扫描 / Incremental Scan
- 证据 / Evidence
- 读取计划 / Agent Read Plan
- 读取建议 / Read Plan
- 快照 / Snapshot
- 原子写入 / Atomic Write


## UI 文案与状态词典（建议落盘为 i18n 键）

用于前端统一文案，减少文案分歧并支持中英双语：

```json
{
  "projectMap.relationship.scan": {
    "zh": "扫描关系",
    "en": "Scan Relationships"
  },
  "projectMap.relationship.scan.emptyState": {
    "zh": "当前项目尚未完成关系扫描，点击扫描后查看文件关系与影响面",
    "en": "No relationship scan yet. Scan to view file relationships and impact."
  },
  "projectMap.relationship.scan.disabledNoWorkspace": {
    "zh": "请先选择一个 Workspace 后再扫描",
    "en": "Select an active workspace before scanning."
  },
  "projectMap.relationship.scan.confirm.title": {
    "zh": "扫描范围较大，确认继续？",
    "en": "Large scan scope detected. Continue?"
  },
  "projectMap.relationship.scan.progress": {
    "zh": "扫描进行中",
    "en": "Scanning in progress"
  },
  "projectMap.relationship.scan.phase.scan": {
    "zh": "文件扫描中",
    "en": "Scanning files"
  },
  "projectMap.relationship.scan.phase.parse": {
    "zh": "关系解析中",
    "en": "Parsing relations"
  },
  "projectMap.relationship.scan.phase.persist": {
    "zh": "结果持久化中",
    "en": "Persisting results"
  },
  "projectMap.relationship.scan.failed.permission": {
    "zh": "权限不足，无法读取目标目录",
    "en": "Permission denied while reading the workspace."
  },
  "projectMap.relationship.scan.failed.path": {
    "zh": "路径不合法或越权，请确认扫描根目录设置",
    "en": "Invalid or unsafe path. Check workspace root configuration."
  },
  "projectMap.relationship.scan.failed.parser": {
    "zh": "部分文件解析失败，已记录失败详情",
    "en": "Some files failed to parse; see details."
  },
  "projectMap.relationship.scan.failed.storage": {
    "zh": "本地写盘失败，旧数据已保留",
    "en": "Storage write failed; previous snapshot is preserved."
  },
  "projectMap.relationship.summary.fresh": {
    "zh": "关系数据为最新",
    "en": "Relationship data is fresh."
  },
  "projectMap.relationship.summary.stale": {
    "zh": "关系数据可能过期，建议重扫",
    "en": "Relationship data is stale. Consider rescanning."
  },
  "projectMap.relationship.repair.clean": {
    "zh": "关系健康：无修复问题",
    "en": "Relationship health: clean"
  },
  "projectMap.relationship.repair.warn": {
    "zh": "关系修复：存在可修复问题",
    "en": "Relationship repair: issues found"
  },
  "projectMap.relationship.impact.title": {
    "zh": "影响面分析",
    "en": "Impact Analysis"
  },
  "projectMap.relationship.hotspot.reason.manyDependents": {
    "zh": "高入度/高出度依赖",
    "en": "High in/out dependency"
  },
  "projectMap.relationship.hotspot.reason.missingTest": {
    "zh": "缺少测试覆盖",
    "en": "Missing test coverage"
  }
}
```

建议把这套键落到 `Project Map` 文案统一文件，后续 UI 文案统一复用。
