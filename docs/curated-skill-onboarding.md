# Curated Skill Onboarding

> **文档性质**：Curated skill **准入与 PR checklist**。
> 准入规则、回退路径；给后续 PR 加新 curated skill 时对照执行。
> 构建期白名单以 `build.rs` / 当前代码为准。
> **导航**：[`README.md`](README.md)

## 准入规则 (Entry Rules)

### R1. License 白名单

`metadata.json` 的 `license` 字段必须严格匹配以下任一值:

- `MIT`
- `Apache-2.0`
- `BSD-2-Clause`
- `BSD-3-Clause`
- `ISC`

**`MPL-2.0` 暂不收** (file-level copyleft, 走法律评审后单独 change)。`Proprietary` / 其它一律 reject。
build.rs 会在 `cargo check` 阶段 `compile_error!` 报错并列出 offender + 完整白名单。

### R2. icon 字段必须 kebab-case ASCII

`metadata.json` 的 `icon` 字段必须满足:

- 仅含小写字母 (`a-z`)、数字 (`0-9`)、连字符 (`-`)
- 例: `sparkles`、`file-text`、`git-branch`、`settings-2`

`Sparkles` (PascalCase) / emoji / 任何非 ASCII 一律 reject。MVP **不强制**校验 lucide icon 名是否真实存在,V1.1 引入完整白名单 (几百个 icon 名)。V0.5.14 走 PR review 人工 verify icon 实际存在。

### R3. category 枚举 (MVP-4)

`metadata.json` 的 `category` 字段必须严格匹配:

- `code-style` — 编码风格、命名、重构指引
- `ui-design` — UI/UX 设计 / prototype / 高保真
- `review` — Code review / 静态分析 / lint
- `debug` — Debug / 故障排查 / profiling

V1.1 扩到 8 个 (`performance / test / docs / git`)。

### R4. tokenEstimate <= 3000

`metadata.json` 的 `tokenEstimate` 字段必须 <= 3000 (经验值 chars/3 估算)。超 3000 reject at build。
LLM context 窗口预算 8000 tokens,单个 curated skill 不应超 3000 tokens,留给系统提示 + 用户消息余量。

### R5. assetPath 安全

- **不能**含 `..` (路径越界)
- **不能**是绝对路径 (`.starts_with('/')` 或 windows drive letter)
- 必须相对 `src-tauri/` 解析,例如 `resources/curated-skills/<name>/SKILL.md`

build.rs 校验。

### R5.5. Tauri 资源映射必须保留 skill 目录

`src-tauri/tauri.conf.json` 的 `bundle.resources` 必须让打包产物保留
`curated-skills/<name>/SKILL.md` 和 `curated-skills/<name>/metadata.json`
这层目录结构。

推荐写法:

```json
"resources/curated-skills": "curated-skills"
```

也可以使用显式单 skill 目录映射:

```json
"resources/curated-skills/<name>": "curated-skills/<name>"
```

禁止写法:

```json
"resources/curated-skills/**/*": "curated-skills/"
```

原因: Tauri map-style glob 会把 `**/*` 匹配到的文件拍平成目标目录,导致
packaged client 里只剩 `curated-skills/SKILL.md` / `metadata.json`,运行时无法
按 lock 里的 `<name>/SKILL.md` 加载。

### R6. 命名冲突

新 curated skill 的 `name` (metadata + lock entry id) **不能**与 `skills-lock.json` 里任何已有 entry 冲突 (bundled 或 curated)。同一 client install 不能有两个同名 skill。

`name` / lock entry id 还必须是 kebab-case ASCII path segment:

- 仅含小写字母 (`a-z`)、数字 (`0-9`)、连字符 (`-`)
- 不能以 `-` 开头或结尾
- 不能包含空白、`/`、`\`、`.`、`_`、引号、emoji 或其它非 ASCII 字符

原因: 该 id 会进入 Settings DOM id/test id、`enabledCuratedSkillIds`、Codex/Claude `<skill id="...">` 注入块和 bundled resource path。限制成单段 kebab-case 可以同时规避路径越界、XML-like attribute 注入和跨平台大小写漂移。

### R7. SKILL.md 顶部 attribution 注释

`SKILL.md` 顶部必须含 `<!-- Upstream: <url> | License: <SPDX> -->` HTML 注释,标注上游来源与协议。client 在 chip tooltip / curated section 也展示 license。

### R8. "何时不启用" 反向说明

`SKILL.md` 末尾必须含 `## 何时不启用 / When NOT to enable` section,说明该 skill 的 anti-patterns 与不适合场景。ponytail 案例: 不适用于 brainstorm、架构重写、未知领域探索、safety-critical 任务。

### R9. PR review checklist (10 项)

1. SKILL.md 顶部有 attribution 注释 (R7)
2. metadata.json 全部 schema 字段非空
3. sha256 与 `shasum -a 256 SKILL.md` 输出一致 (lock entry 的 `computedHash` 已更新); `SKILL.md` 必须通过 `.gitattributes` 固定为 LF,避免 Windows checkout 转成 CRLF 后 hash 漂移
4. license 在白名单 (R1) — `MPL-2.0` 单独评审
5. icon kebab-case ASCII (R2)
6. category 在 MVP-4 枚举 (R3)
7. tokenEstimate <= 3000 (R4)
8. 命名不与已有 curated / bundled entry 冲突,且满足 kebab-case ASCII id 规则 (R6)
9. SKILL.md 末尾有 "何时不启用 / When NOT to enable" section (R8)
10. `tauri.conf.json` 使用目录映射保留 `<name>/` 目录结构,不得使用 `resources/curated-skills/**/*` glob 映射 (R5.5)

## 回退路径 (Rollback Paths)

紧急响应 3 条独立路径,可任选其一:

### Rollback (a) — 编译期软降级

`src-tauri/build.rs` 把 `panic!("curated skill lock hash mismatch ...")` 临时改成 `eprintln!(...)` (warn-only),允许带 stale lock 发版。后续 change 必须还原回 `panic!` 恢复硬校验。

### Rollback (b) — 资产层

两步:

1. `src-tauri/tauri.conf.json` 的 `bundle.resources` 移除两条:
   - `"resources/curated-skills": "curated-skills"` (或所有显式 `resources/curated-skills/<name>` 映射)
   - `"../skills-lock.json": "."`
2. `skills-lock.json` 删除所有 `kind: "curated"` entry (当前仅 `lazy-senior-dev`)

发版后: 客户端 binary 不含 `curated-skills/` 资源目录,`Settings -> Curated` 段渲染为空,`get_curated_skills` IPC 返回 `[]`,所有 IPC 调用安全 no-op。

### Rollback (c) — 运行时软下线

`src-tauri/src/command_registry.rs` 的 `set_curated_skill_enabled` handler 顶部加 flag:

```rust
if std::env::var("CCGUI_CURATED_SKILLS_DISABLED").is_ok() {
    log::warn!("curated skills disabled by feature flag, returning current settings");
    return Ok(settings_core::get_app_settings_core(&state.app_settings).await);
}
```

效果:

- IPC 返回 success (前端 toggle UI 不报错)
- `AppSettings.enabled_curated_skill_ids` **不变** (user toggle 视觉上不响应)
- readiness-bar indicator / Curated section 继续渲染
- 下次 LLM 调用的 Codex/Claude 注入用**未变更**的 enabled set (空或 stale)
- "软 kill-switch": UI 可见,功能空转,适合"先发版修其他事,curated 后修"场景

## V1.1 follow-up (本轮不修)

| 编号 | 事项 | 来源 |
|---|---|---|
| 1 | lucide-react icon 完整白名单 (几百个) | design Decision 9 |
| 2 | MPL-2.0 license 准入 (走法律评审) | proposal §4 风险与回退 |
| 3 | 中文 token 估算精度 (`tiktoken-rs` 升级) | design Decision 10 |
| 4 | category 枚举扩到 8 个 (performance / test / docs / git) | proposal §R3 |
| 5 | Composer `@` 触发 curated skill picker | proposal 权衡 1 |
| 6 | i18n key 补全 (Curated 桶头 / readiness indicator 文案) | design N10 |
| 7 | `skills-lock.json` 9 个 bundled entry 资产真落盘 | design Decision 2 |
| 8 | `useAppSettings.normalizeAppSettings` 前向兼容新字段 | design N4 |
