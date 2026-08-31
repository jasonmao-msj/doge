## 1. Capability Evidence

- [x] 1.1 [P0][Depends:none][Input: current Codex custom-provider request][Output: request tool/Lite facts][Verify: local capture shows no hosted image tool and production turn has no native image item] 证明原始失败。
- [x] 1.2 [P0][Depends:1.1][Input: token2api production policy][Output: group/channel/account bridge state][Verify: Doge APP allows images; hosted bridge enabled; native turn still fails] 排除开关缺失。
- [x] 1.3 [P0][Depends:1.2][Input: bundled catalog + temporary `model_catalog_json`][Output: non-Lite A/B evidence][Verify: token2api usage records Doge Managed `gpt-5.6-luna` `按次(图片)` 1 image] 证明catalog方案。
- [x] 1.4 [P0][Depends:1.3][Input: explicit Responses image tool][Output: upstream payload evidence][Verify: completed `image_generation_call`, base64 result length > 0] 证明上游真实生图。

## 2. Managed Catalog Materialization

- [x] 2.1 [P0][Depends:1.3][Input: exact Codex binary][Output: bounded bundled catalog export][Verify: success/non-zero/timeout/oversize tests] 实现probe。
- [x] 2.2 [P0][Depends:2.1][Input: exported catalog][Output: exact three-slug non-Lite catalog][Verify: preserves unknown fields、rejects missing/duplicate/malformed entries] 实现patch。
- [x] 2.3 [P0][Depends:2.2][Input: isolated provider home][Output: atomic managed catalog artifact][Verify: repeated write stable、no partial file] 实现materialization。

## 3. Launch Integration And Migration

- [x] 3.1 [P0][Depends:2.3][Input: managed provider binding][Output: `model_catalog_json` absolute launch override][Verify: app-server args contain override only for `doge-token-matrix`] 接入launch owner。
- [x] 3.2 [P0][Depends:3.1][Input: fresh/legacy Product users][Output: automatic next-launch convergence][Verify: no login blocking、no global config mutation、old provider home repaired at exact send boundary] 覆盖新老用户。
- [x] 3.3 [P1][Depends:3.1][Input: local/custom providers][Output: unchanged launch behavior][Verify: focused exclusion tests] 隔离非Product路径。

## 4. Spec, Verification And Delivery

- [x] 4.1 [P0][Depends:3.3][Input: launch contract][Output: Trellis Codex runtime contract + foundation ADR calibration][Verify: code paths/change id] 回写knowledge。
- [x] 4.2 [P0][Depends:4.1][Input: Rust/docs changes][Output: L3 focused verification][Verify: focused tests、rustfmt、cargo check、OpenSpec strict、git diff] 自动验证。
- [x] 4.3 [P0][Depends:4.2][Input: managed Hot Doge][Output: real generated image artifact][Verify: bundled Codex remote image accounting + existing native image realtime/history/reducer 89-test suite] 端到端验收。
- [ ] 4.4 [P1][Depends:4.3][Input: reviewed branch][Output: Chinese Conventional Commit、Trellis record、PR][Verify: matrix decision、evidence and CI gates in PR] 交付review。
