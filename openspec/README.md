# doge OpenSpec Workspace

本目录是 `doge` 的 behavior-spec 工作区，负责 proposal / design / tasks / specs / archive 的生命周期管理。

## 先看哪里

- 仓库级规则入口：[`../AGENTS.md`](../AGENTS.md)
- 若正在修改规则入口、文档治理边界或 ignore policy：[`../.trellis/spec/guides/project-instruction-layering-guide.md`](../.trellis/spec/guides/project-instruction-layering-guide.md)
- 工作区总览与治理状态：[`project.md`](project.md)
- 当前提案与执行状态：[`changes/README.md`](changes/README.md)
- 主 capability specs：[`specs/README.md`](specs/README.md)
- 完整归档提案索引：[`changes/archive/README.md`](changes/archive/README.md)
- 审计、同步与 evidence 文档：[`docs/README.md`](docs/README.md)

## 目录说明

- `project.md`
  - 详细治理总览、capability metrics、active changes、update history
- `changes/`
  - 每个变更的 proposal / design / tasks / spec deltas；`README.md` 提供 active proposal 索引
- `changes/archive/`
  - 已归档 change artifacts；`README.md` 按月份 / 归档日期索引全部 proposal
- `specs/`
  - 当前主线 capability 规范；`README.md` 完整索引 492 个已同步 capability
- `docs/`
  - 审计、验证、同步与研究辅助文档；`README.md` 区分 durable reference 与 dated snapshot
- `config.yaml`
  - OpenSpec 1.3.x planning context 配置

## 使用约定

- 行为变更必须先进入 `openspec/changes/<change-id>/`
- 完成实现后执行 verify，再按需要 sync / archive
- 收口 / archive 前若命中基石 ADR 更新触发器，须先回写 `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 校准段（gate 定义见 `AGENTS.md` 全局 Gate「ADR 校准回写 Gate」）
- 新增 capability 优先沿用现有命名空间策略，避免引入无必要的平行前缀

## 常用命令

```bash
openspec validate --all --strict --no-interactive
openspec status --change <change-id>
python3 .claude/skills/osp-openspec-sync/scripts/validate-consistency.py --project-path . --full
```

## 维护边界

- 仓库级入口、规则优先级、全局 gate 统一维护在 `AGENTS.md`
- 规则分层与“改哪里”的边界说明维护在 `.trellis/spec/guides/project-instruction-layering-guide.md`
- `openspec/README.md` 只做导航和使用入口
- 详细治理说明、快照统计、active backlog 与审计历史统一维护在 `openspec/project.md`
- active / archived proposal 的逐项链接统一维护在 `openspec/changes/README.md` 与 `openspec/changes/archive/README.md`
- main capability spec 的完整导航维护在 `openspec/specs/README.md`
- audit/evidence artifact 的事实分层维护在 `openspec/docs/README.md`
