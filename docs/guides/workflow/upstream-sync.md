---
type: guide
status: active
---

# doge 上游同步工作流

> **受众**：doge maintainers
> **边界**：developer-only Git workflow；不得链接到 App、About、release notes 或用户文档
> **Canonical upstream**：`https://github.com/zhukunpenglinyutong/desktop-cc-gui.git`

doge 的 `main` 是产品与发布事实源。上游 remote 只提供代码 provenance 和人工同步输入，不是运行时配置，也不向用户暴露。同步采用 merge，保留公开 Fork 的同步节点与 doge release history。

## 安全拓扑

| Remote | Fetch | Push |
|---|---|---|
| `origin` | `https://github.com/jasonmao-msj/doge.git` | doge repository |
| `upstream` | `https://github.com/zhukunpenglinyutong/desktop-cc-gui.git` | `DISABLED` |

首次设置或修复 topology：

```bash
git remote set-url origin https://github.com/jasonmao-msj/doge.git
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/zhukunpenglinyutong/desktop-cc-gui.git
git remote set-url upstream https://github.com/zhukunpenglinyutong/desktop-cc-gui.git
git remote set-url --push upstream DISABLED
npm run check:upstream-sync
```

`npm run check:upstream-sync` 只读取 repo-local `remote.origin.*` 与 `remote.upstream.*`。它不执行 `fetch`，不修改 `.git/config`，也不访问网络。

## 每次同步

1. 确认 `main` clean，并运行 `npm run check:upstream-sync`。
2. 创建隔离分支：`git switch -c sync/upstream-YYYYMMDD`。同日重复同步时追加短序号。
3. 人工执行 `git fetch upstream main`，记录待同步 commit range。
4. 先用 `git diff --stat main...upstream/main` 与 `git log --oneline main..upstream/main` 审阅范围，再执行 `git merge --no-commit --no-ff upstream/main`。
5. 对 identity、release、storage、protocol 和 current docs 建 capability matrix，逐项做 semantic merge。高风险文件禁止整文件 `--ours` / `--theirs` 覆盖。
6. 冲突处理完成后先运行 `npm run check:branding`，再运行 migration、updater、locale 等受影响 focused tests。
7. 运行 `npm run check:docs`、`npm run lint`、`npm run typecheck`、frontend/Rust full tests 与目标平台 build；全部通过后才能合入 doge `main`。

若需要放弃未完成的 merge，使用 `git merge --abort`。不要为解决品牌冲突恢复上游 updater key、analytics、managed service endpoint 或 legacy 写路径。

## Shipping boundary

- Remote URL 只存在于 local `.git/config`、本 developer guide、只读 audit 与必要 provenance allowlist。
- App runtime、bundled config、About、错误反馈、README、download/update endpoint 和 release asset 不得包含 upstream remote。
- 保留 `LICENSE`、Git history 与必要 compatibility reader 的真实归属；例外必须有窄路径/行匹配、`reason` 和 `removalCondition`。
- upstream merge 后若 branding gate 报告旧品牌或专属服务，必须逐项判断为迁移兼容、法律事实或应删除的 shipping regression，禁止用目录级 allowlist 消音。
