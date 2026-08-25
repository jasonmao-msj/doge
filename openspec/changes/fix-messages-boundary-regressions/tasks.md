## 1. Evidence and plan

- [x] 1.1 **P0 · deps: none** — 在当前与历史 main commits 复现 `inbound=14 / outbound=69 / new=35`，确认不是 PR #23 引入。
- [x] 1.2 **P0 · deps: 1.1** — 分类 35 条 edge，定义 neutral owner、public API、host slot 与 test decoupling 方案。
- [x] 1.3 **P0 · deps: 1.2** — strict validate OpenSpec artifacts，初始化并关联 Trellis task。

## 2. Neutral ownership migration

- [x] 2.1 **P0 · deps: 1.3** — 迁移 live text、render scheduling、history progress 与 multi-agent canvas presentation 到 neutral conversation owner。
- [x] 2.2 **P0 · deps: 1.3** — 迁移 agent notification、task navigation、file presentation primitives 到 contracts/services/utils owner。
- [x] 2.3 **P0 · deps: 1.3** — 迁移 Shared projection 到 Shared Session owner，清理 Messages projection test coupling。

## 3. Dependency inversion and public surface

- [x] 3.1 **P0 · deps: 2.1,2.2** — Layout host composition 接管 Prompt Distill，Messages 只消费 `onSaveAsPrompt`。
- [x] 3.2 **P0 · deps: 2.1** — Multi-Agent History Fold 通过 stable timeline render slot 注入。
- [x] 3.3 **P1 · deps: 2.1,2.2,2.3** — external callers 改用 Messages public index 或 neutral owner；删除无效 peer-store test coupling。

## 4. Gate and verification

- [x] 4.1 **P0 · deps: 3.1,3.2,3.3** — 收缩 exact outbound baseline，达到 `inbound=0 / new=0`，保留 deterministic negative fixtures。
- [x] 4.2 **P0 · deps: 4.1** — 增补/更新 focused regressions，执行 L3 verification matrix。
- [x] 4.3 **P1 · deps: 4.2** — `$check-cross-layer`、`$check`、`$finish-work` 复核并记录未覆盖的 L4 scope。
- [x] 4.4 **P0 · deps: 4.3** — commit、push并创建 PR #24。
- [x] 4.5 **P0 · deps: 4.4** — 手动 dispatch CI；修复解除 typecheck 阻断后暴露的 Windows provenance path separator 误报。
- [ ] 4.6 **P0 · deps: 4.5** — push follow-up，重跑失败 CI jobs 并记录 terminal state。
