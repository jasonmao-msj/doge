# OpenSpec + Trellis Team Playbook

> **文档性质**：团队流程**短手册**。细节与权威路径以仓库 `openspec/`、`.trellis/`、`AGENTS.md` 为准。
> **导航**：[`README.md`](README.md) · 分析过程 [`analysis/README.md`](analysis/README.md)

## 1. 目标

在同一仓库内统一规范与执行：

- OpenSpec 管需求/行为规范（`openspec/`）
- Trellis 管任务执行与会话过程（`.trellis/`）

## 2. 角色与职责

- 需求提出者：创建或确认 OpenSpec change。
- 开发执行者：创建 Trellis task，并绑定 OpenSpec change。
- 评审者：检查 PR 是否包含 change/task 映射、验证结果是否完整。

## 3. 日常流程（必须）

1. 选择或创建 OpenSpec change。
2. 创建 Trellis task（标题或描述写明 `change-id`）。
3. 开发与自测。
4. 运行 OpenSpec 校验并完成 sync/archive（按发布策略）。
5. PR 中写清映射关系与验证证据。

## 4. 命令模板

```bash
# 查看/创建 change
openspec list
openspec new change "<change-id>"

# 查看任务并开始执行
python3 ./.trellis/scripts/task.py list
python3 ./.trellis/scripts/task.py create "<task-title>" --slug <task-slug>
python3 ./.trellis/scripts/task.py start <task-slug>

# 开发完成后校验
openspec validate --change "<change-id>" --strict

# 根据策略选择
openspec sync --change "<change-id>"      # 仅同步主 specs，不归档
openspec archive "<change-id>"            # 完成后归档

# 结束任务
python3 ./.trellis/scripts/task.py finish
```

## 5. PR 模板（建议）

```text
OpenSpec Change: <change-id>
Trellis Task: <task-slug>
Validation:
- openspec validate --change "<change-id>" --strict : PASS/FAIL
- test/lint/typecheck : PASS/FAIL
```

## 6. 没装 CLI 的同事怎么协作

- 可以正常开发代码。
- 但 PR 必须填写 OpenSpec change 和 Trellis task 映射。
- 由已安装 CLI 的同事补跑 `openspec validate` 与归档步骤。

## 7. 约束（红线）

- 行为变更不得绕过 OpenSpec 记录。
- 一个 Trellis task 只能绑定一个主 change（避免责任漂移）。
- 未完成验证不得归档 change。
