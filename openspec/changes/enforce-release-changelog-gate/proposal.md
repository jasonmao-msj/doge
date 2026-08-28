## Why

doge App 的版本记录读取 committed `CHANGELOG.md`，而 Release workflow 又独立扫描 Git history
生成 GitHub Release body；两条 authority 会漂移。`v0.1.3` 已出现 App 仍展示 `v0.1.0`、GitHub
Release body 因误选上游高版本 tag 而累计历史内容的问题，发布后的自动 bump PR 还会因 Actions 权限
失败，使成功发布显示为红色。

## 目标与边界

- committed `CHANGELOG.md` 成为 App 版本记录与 GitHub Release body 的 single source of truth。
- AI 在 release preparation PR 中同时更新六处版本文件与当前版本中英文 changelog entry；普通开发者
  不维护 release notes。
- CI 与正式 Release preflight 执行同一个 deterministic `release:check`；不合法时在平台构建前 fail closed。
- Release workflow 只提取 committed current entry，不修改仓库、不创建 PR、不在发布后 bump version。
- 回填 doge `v0.1.1`、`v0.1.2`、`v0.1.3` 历史，使下一安装包可离线展示完整记录。

## 非目标

- 不让 App 运行时请求 GitHub API、Release 页面或其它远端 notes endpoint。
- 不由 CI 机械翻译 release notes；双语用户文案由 AI 在 release preparation 阶段整理。
- 不在本 PR 创建新版本、tag 或 GitHub Release，也不配置 tag ruleset/GitHub App。
- 不改变 updater signature、platform artifact 或下载安装 contract。

## What Changes

- 增加 Release Changelog Gate 项目规则与 release preparation guide。
- 增加 Node-only changelog parser/validator/extractor，校验六处版本、entry 顺序、日期、双语正文。
- 增加 `npm run release:check`，接入 CI typecheck job 与 signed Release preflight。
- Release job 从 CHANGELOG 提取当前版本 body 供 `latest.json.notes` 与 `gh release create` 共用。
- 删除 Git history notes generator 与 post-release `Bump version and open PR` step。
- 正式发布只允许从 `main` dispatch，并把 write permission 收窄到最终 publish job。
- 增加 workflow/static/unit contract tests并回填历史 changelog。

## 方案对比

1. **采用：AI committed CHANGELOG + executable gate。** 用户文案质量高，源码/tag/artifact/Release 一致，
   App 完全离线；普通开发者无感。
2. **否决：workflow 临时生成未提交 CHANGELOG。** 可自动构建，但 tag source 与 artifact 不一致，无法复现。
3. **否决：App 请求 GitHub Releases API。** 引入用户网络、限流和 GitHub 可达性依赖。

## 验收标准

- `release:check` 对当前仓库通过；version mismatch、缺语言、重复/乱序 entry 必须失败。
- App parser 能读取回填后的 `v0.1.1～v0.1.3`，当前版本 `0.1.3` 定位到第一条。
- CI typecheck job 与正式 release preflight 均运行同一个 gate。
- workflow 不含 `git tag --sort=-version:refname`、commit-scan notes generator、`gh pr create` 或 post-release bump。
- `release-artifacts/release-notes.md` 只能由 committed current entry 提取，`latest.json` 与 GitHub Release 共用。
- workflow 默认只读、无 PR write，且非 `main` signed dispatch 在平台构建前失败。
- release workflow contract、focused parser/script tests、branding/docs checks、OpenSpec strict validation 通过。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `doge-release-updater`: 增加 committed CHANGELOG authority、AI release preparation 与 fail-closed
  changelog preflight contract。

## Impact

- Repo governance：`AGENTS.md`、`.trellis/spec/guides/**`、backend release contract。
- Release automation：`scripts/release-changelog*`、`package.json`、`ci.yml`、`release.yml`。
- Product data：`CHANGELOG.md` backfill；App renderer仍沿用现有 lazy parser/modal。
- API/storage/dependency：无新增 dependency、无 runtime API、无 migration。
