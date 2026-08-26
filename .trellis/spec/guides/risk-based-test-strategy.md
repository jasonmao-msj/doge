# Risk-Based Test Strategy（按影响面分层验证）

## 目标

本地开发验证必须与真实影响面匹配。小修小改优先快速获得高相关性反馈；跨层、高风险改动扩大验证范围；全量测试、跨平台构建与 smoke test 由 Release/CI 统一承担。

本规则取代“每次提交前无条件运行全部 lint/typecheck/test”的做法。测试等级由最高风险触发项决定，而不是仅按修改行数判断。

## 测试等级

| Level | 典型影响面 | 本地最低验证 | 不要求 |
|---|---|---|---|
| **L0 文档/静态事实** | Markdown、注释、OpenSpec、非执行配置说明 | `git diff --check`；对应 docs/OpenSpec/schema validator | runtime test、全量 lint/typecheck |
| **L1 Leaf** | 单个 leaf component/helper/copy/style；无 shared contract、持久化或 runtime routing | changed/nearest focused test；changed TS/TSX targeted ESLint；有可见 UI 时做最小目视验证 | `npm run test`、全仓 lint；无 type boundary 时可不跑全量 typecheck |
| **L2 Feature** | 同一 feature slice 多文件、feature hook/store/service、共享纯 helper | affected feature test files；`npm run typecheck`（TS）；targeted ESLint；对应 static/contract check | 全量 Vitest、全量 Rust tests |
| **L3 Cross-layer / High-risk** | React→service→Tauri/Rust、IPC、auth/vault、provider/engine routing、session/persistence/schema、installer/updater、startup、并发/恢复、跨平台 | 各受影响层 focused/integration tests；相关 contract/static checks；TS typecheck；Rust targeted test + 必要的 `cargo check --lib`；平台相关变更做对应本地/CI smoke | 默认不跑全量 `npm run test` / `cargo test`，除非无法界定影响面或用户明确要求 |
| **L4 Release / CI** | release candidate、merge-to-main gate、正式安装包、用户明确要求全量 | 全量 JS/Rust tests、lint、typecheck、contracts、build、platform smoke；以 CI 结果为准 | 无 |

## 等级判定规则

1. 先列 changed files、调用链、状态 owner、持久化边界和平台影响，再选择等级。
2. 命中多个等级时选择最高等级。
3. 文件少不等于风险低：一行 IPC、vault、schema、engine routing 或 startup 改动仍是 L3。
4. 测试文件、test harness、CI gate 本身发生变化时，至少 L2；改变全量测试发现/分批/过滤语义时为 L3。
5. 仅修改正式 spec/guide 时通常为 L0；若同时修改执行代码，跟随代码等级。

## 命令选择

### Frontend focused examples

```bash
npx vitest run src/features/<feature>/<affected>.test.tsx
npx eslint src/features/<feature>/<changed>.ts src/features/<feature>/<changed>.tsx
npm run typecheck                       # L2/L3，或任何 exported type/contract 变更
```

### Backend focused examples

```bash
cargo test --manifest-path src-tauri/Cargo.toml <module_or_test_filter>
cargo check --manifest-path src-tauri/Cargo.toml --lib
npm run check:runtime-contracts         # IPC/runtime contract 命中时
```

### Governance examples

```bash
git diff --check
openspec validate <change-id> --type change --strict --no-interactive
npm run check:docs                      # docs governance 命中时
```

命令必须来自真实受影响 surface；禁止为了“看起来验证过”而运行无关测试。

## 扩围与失败处理

- Focused test 失败：先修复并重跑同一层；若失败暴露 adjacent owner/consumer，再升一级扩大测试。
- Platform batched test timeout：先核对 assertion owner 与 mounted tree。若 leaf behavior 可由 child component + real pure helpers 表达，必须先收窄 harness；只有确有 platform I/O/runtime latency contract 时才提高 timeout，并记录量测证据。
- 找不到现有测试：对行为修复优先补最小 regression；纯视觉/平台行为允许记录 manual evidence。
- L0–L3 无需因未运行全量 suite 而阻塞；交付时必须明确写出等级、已运行命令和未覆盖范围。
- 若主动运行全量 suite 遇到与本改动无关的 baseline failure，不应冒充本次变更失败；记录 failing suite 与隔离证据，交给对应 owner。
- 无法可靠界定影响面时升到 L3；只有 Release/CI 或用户明确要求时升到 L4。

## Release / CI Contract

- GitHub CI 保持全量 `npm run test`、`cargo test`、lint、typecheck、contract checks 和平台 job。
- Release workflow 继续负责正式 build、installer、checksum、签名（如配置）和 startup smoke。
- 本地 L0–L3 的快速反馈不替代 Release CI；Release CI 也不应成为日常 leaf fix 的同步阻塞步骤。

## 交付报告模板

```text
Verification level: L2 Feature
Why: changed one feature hook + its component consumer; no IPC/persistence/runtime routing
Ran:
- npx vitest run <affected tests>
- npx eslint <changed files>
- npm run typecheck
Not run:
- npm run test（L4 Release/CI）
```

## Good / Base / Bad

- **Good**：Composer leaf regression 只跑 Composer focused tests；provider/vault transition 按 L3 跑 Composer + AccountGate + runtime contract，而非 1100+ 个无关 test files。
- **Good**：Project Map disclosure 由 `ProjectMapNavigationPanel` focused test 覆盖，path algorithm 留在 pure helper test；不为 leaf assertion 挂载完整 graph parent。
- **Base**：共享 TS type 改动跑 affected suites + full typecheck，但不跑全量 Vitest。
- **Bad**：改一行 copy 后跑 30–60 分钟全量测试；或修改 IPC/schema 只跑一个 snapshot test。
- **Bad**：Windows batch 下 parent harness 超过 5s 后直接把单测 timeout 改成 15s，却不检查 assertion 是否属于 leaf component。
