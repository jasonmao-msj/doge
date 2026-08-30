## 1. Upstream Capability Spike

- [x] 1.1 [P0][Depends:none][Input: production `Doge APP` route UI][Output: `claude-*` Responses→Anthropic prefix route][Verify: saved enabled priority-100 route with raw prefix passthrough] 建立route。
- [x] 1.2 [P0][Depends:1.1][Input: managed key + `claude-opus-4-8`][Output: minimal Responses terminal][Verify: status=completed、text=OK、exact model] 完成endpoint probe。
- [x] 1.3 [P0][Depends:1.2][Input: managed Codex runtime][Output: real Claude-model Codex turn][Verify: requested model + typed terminal + no fallback] 完成CLI evidence。

## 2. Contract And Client Projection

- [x] 2.1 [P0][Depends:1.2][Input: verified route matrix][Output: Claude fallback=`openai-responses + anthropic-messages`][Verify: Rust normalization covers order、explicit authority、unknown fail-closed] 更新Native facts。
- [x] 2.2 [P1][Depends:2.1][Input: canonical row][Output: one Product target projection][Verify: compatibility/target/picker/Panel-Kanban fixtures show Codex+Claude and exclude Kimi] 更新Renderer regressions。
- [x] 2.3 [P0][Depends:2.1][Input: exact catalog pair][Output: create/Shared/send validation accepts Claude-in-Codex][Verify: frozen catalog id/runtime model/provider reaches existing Codex runtime] 核对execution parity。

## 3. New And Upgrade Configuration Convergence

- [x] 3.1 [P0][Depends:2.1][Input: routing contract change][Output: managed configuration revision 2][Verify: fresh builders write2; verifier rejects missing/1] bump revision。
- [x] 3.2 [P0][Depends:3.1][Input: revision-1 registry + local/custom siblings][Output: deterministic current managed entries][Verify: migration preserves siblings、removes drift、repeated prepare stable] 覆盖upgrade。
- [x] 3.3 [P1][Depends:3.2][Input: startup catalog-only + send-time exact prepare][Output: non-blocking login and pre-side-effect convergence][Verify: Product Gate/provisioning tests] 保持lazy UX。

## 4. Spec, Verification And Delivery

- [x] 4.1 [P0][Depends:2.3,3.3][Input: provider/protocol change][Output: Trellis contracts + foundation ADR calibration][Verify: current code paths/change id] 回写knowledge。
- [x] 4.2 [P0][Depends:4.1][Input: Rust/TS/docs changes][Output: L3 focused verification][Verify: focused Vitest/Rust、typecheck、target ESLint、cargo check、contracts/docs/OpenSpec strict、git diff] 自动验证。
- [x] 4.3 [P0][Depends:1.3,4.2][Input: hot doge clean + legacy config][Output: picker/send visual evidence][Verify: Codex lists/sends Claude；other consumers consistent] 目视验收。
- [ ] 4.4 [P1][Depends:4.3][Input: reviewed branch][Output: Chinese Conventional Commit、Trellis record、PR][Verify: onboarding matrix、CLI/CI/manual evidence in PR] 交付review。
