## Context

当前数据流分裂：

```text
App -> dynamic import CHANGELOG.md?raw -> bilingual parser
Release workflow -> global version-sorted tag -> git log -> generated body
```

`CHANGELOG.md` 只含 `v0.1.0`。Release workflow 的 `git tag --sort=-version:refname` 会先看到
继承自上游的 `v0.8.x`，而不是最近可达 doge tag；因此生成累计 notes。发布完成后再 bump 版本也太晚，
且 Actions 没有创建 PR 权限。

## Goals / Non-Goals

**Goals:**

- 一个 committed artifact 同时服务 App offline UI 与 GitHub Release。
- AI 写用户文案，脚本只负责结构/一致性/提取，避免低质量机械翻译。
- CI、Release 复用同一个 validator，忘记更新时在 build matrix 前失败。
- workflow 成功状态只反映 build/publish，不被 post-release automation 污染。

**Non-Goals:**

- 不自动决定产品文案，不请求 remote release history。
- 不改变 UI layout、updater payload schema 或 tag permission policy。

## Decisions

### 1. CHANGELOG 是唯一内容 authority

AI 在 version preparation PR 中 prepend/replace current entry。Entry 沿用现有 parser 格式：

```md
### **2026年8月28日（v0.1.3）**

中文：
...

English:
...
```

Workflow 使用 extractor 生成：

```md
## 中文
<chinese body>

## English
<english body>
```

同一文件进入 Vite/Tauri build，source commit、tag、artifact 与 GitHub body 可复现。

### 2. Validator 是纯 Node、零依赖、双入口强制

`scripts/lib/releaseChangelog.mjs` 提供 parse/version/extract/validate pure functions；
`scripts/check-release-changelog.mjs` 提供 CLI：

```bash
node scripts/check-release-changelog.mjs
node scripts/check-release-changelog.mjs --extract-current <output>
```

校验矩阵：六处 version equality、current entry first、三段 SemVer、合法日期、unique descending entries、
中文/English non-empty。CI 与 Release preflight调用 `npm run release:check`。

### 3. Release workflow 不再拥有 mutation

`release_preflight` 验证 trust chain 后执行 changelog gate；platform jobs仍只依赖 preflight。Release job
checkout committed source，extract notes 后生成 `latest.json` 并发布。删除 post-release bump/PR。
Workflow 默认只有 `contents: read`；仅最终 `release` job 获得 `contents: write`，不再申请
`pull-requests: write`。正式 signed release 还必须从 `refs/heads/main` dispatch，避免从未 review 分支发布；
artifact-only 内部构建不受此限制。

### 4. AI rule 与 executable enforcement 分层

`AGENTS.md` 只写全局 gate；详细步骤、格式、Good/Bad 与 commands 进入 Trellis guide/code-spec；OpenSpec
定义 behavior。AI 发布必须以 release preparation PR为边界，不能在发布 runner 临时写 notes。

## Validation and Error Matrix

| Case | Required result |
|---|---|
| 六处 version 一致、current entry完整 | check pass，允许 build |
| App version 已变、CHANGELOG 未更新 | CI + release preflight fail |
| 中文或 English 空 | fail |
| duplicate / non-descending version | fail |
| current entry extraction | body exact，供 latest.json + GitHub Release 共用 |
| artifact-only workflow | 不进入 signed preflight/release notes gate，保留内部构建语义 |
| signed release | gate 必须运行且禁止 skip flag |
| signed release from non-main ref | preflight fail before platform matrix |
| workflow permissions | 默认 `contents: read`，只有最终 publish job 可 `contents: write`，无 PR write |

## Risks / Trade-offs

- [Risk] AI release notes 与 commit list不完全一一对应。→ 规则要求只覆盖 last reachable tag 后用户变化；PR
  review保留审计，结构 gate不假装判断产品文案质量。
- [Risk] 历史 backfill 是人工整理。→ 本 PR用 published release/tag facts回填，并以 parser fixtures锁定。
- [Risk] workflow extraction与 App parser漂移。→ Node parser单测 + existing frontend parser test使用同一真实
  CHANGELOG fixture验证版本集合。

## Migration Plan

1. 引入 parser/check/extract与 tests，先让当前 `0.1.3` backfill通过。
2. 接入 CI/Release preflight与 release body extraction。
3. 删除旧 generator/post-release mutation。
4. 更新 project/OpenSpec/Trellis contracts并完成 L3 verification。

Rollback：恢复旧 release notes generator不会影响 updater artifacts，但会重新引入 authority drift；
`CHANGELOG.md` backfill 本身保持向后兼容。

## Open Questions

无。Tag ruleset/GitHub App 属于可选的手工 Release hardening，不阻塞本 change。

## Follow-up Calibration: Legacy Tag Collision

2026-08-28 首次按本 contract 准备下一版本时，发现 `origin` 已保留上游 `v0.1.4`～`v0.1.9`
tags，且 `v0.1.4` 指向非 doge release commit。仅检查 GitHub Release 是否存在不足以证明 tag 可用。

决策：不 destructive retag；doge 选择第一个未占用的 `v0.1.10`。Signed preflight 必须从 canonical
version构造 exact ref，并在任何 platform build 前通过 remote tag lookup证明不存在；artifact-only lane
仍允许对任意 ref 做内部构建。
