# Release Preparation Guide

## 适用范围

用户要求发布 doge 新版本，或任务修改 canonical version、`CHANGELOG.md`、`.github/workflows/release.yml`
时，AI MUST 使用本指南。普通 feature developer 不需要维护 release notes。

## Canonical Flow

```text
sync origin/main
  -> identify nearest reachable release tag
  -> curate bilingual user-facing delta
  -> update six versions + CHANGELOG in one preparation PR
  -> release:check
  -> merge PR
  -> dispatch signed Release with both artifact-only inputs false
  -> verify tag/assets/latest.json
```

Signed Release MUST 从 `main` dispatch；workflow 会在 platform matrix 前验证
`GITHUB_REF=refs/heads/main`。非 main ref 只用于明确的 artifact-only 内部构建。

正式发布前 MUST 更新：

- `config/brand.json`
- `package.json`
- `package-lock.json`（root + `packages[""]`）
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`（`doge` package）
- `src-tauri/tauri.conf.json`
- `CHANGELOG.md`

## CHANGELOG Contract

最新 entry MUST 位于第一条，格式：

```md
### **YYYY年M月D日（vX.Y.Z）**

中文：

<用户可读 Markdown>

English:

<user-facing Markdown>
```

- 只总结 nearest reachable release tag 到当前 `main` 的用户可见变化。
- 必须把多个内部 commits 收敛为产品能力/修复，不得直接倾倒 commit log。
- `chore`、Trellis、tests、内部 refactor/build noise 默认不进入；若它们改变安装/发布体验，可按用户影响归并。
- 中文与 English 均由 AI curate，禁止 CI 伪翻译、复制同一语言或留 placeholder。
- 保留历史 entry；重做同一待发布版本时 replace current entry，禁止 duplicate version。

查找前一版本使用 topology，而不是全局 SemVer 最大值：

```bash
git describe --tags --abbrev=0 --first-parent HEAD^
```

禁止 `git tag --sort=-version:refname | head -n 1`；仓库含上游高版本 tags，会选错 release range。

## Mandatory Checks

```bash
npm run release:check
npm run release:check:test
node --test scripts/release-workflow.contract.test.mjs
npm run check:branding
git diff --check
```

正式 Release 使用 committed current entry：

```bash
node scripts/check-release-changelog.mjs \
  --extract-current release-artifacts/release-notes.md
```

该文件 MUST 同时进入 `latest.json.notes` 与 `gh release create --notes-file`。

## Failure / Recovery

- version drift、current entry 缺失、双语为空、duplicate/乱序版本：修 release preparation PR；禁止在 runner hot-patch。
- Release 在平台 build 前被 changelog gate 阻断：修 PR、合入后重新 dispatch。
- GitHub Release 创建成功而后续非发布动作失败：不得把 post-release mutation 放回 workflow；发布成功后只核验 assets/feed。
- 手工 Actions UI dispatch仍必须过 gate；GitHub Releases UI direct tag/release不属于支持路径。

## Good / Base / Bad

- Good：AI 把三个 engine-routing commits 合并为一条“修复新建会话和页面切换的引擎路由”，双语一致。
- Base：纯内部 test/chore 无用户变化时不列入；但 current entry仍必须有本版本真实用户变化。
- Bad：workflow 从全部 tags 取最高版本、扫描 commits生成另一份 body，或发布后再 bump version。
- Bad：App 请求 GitHub Releases API；Version History 必须完全离线。
