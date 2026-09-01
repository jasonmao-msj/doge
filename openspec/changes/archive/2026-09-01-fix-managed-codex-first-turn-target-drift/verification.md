# Verification: fix-managed-codex-first-turn-target-drift

## Status

Native target + Shared generated-image convergence implemented；Hot Doge visual acceptance passed。

## Evidence

- Root-cause request `dfd3c3d3-9b78-468e-99b1-53ebca4051ae`：token2api `channel pricing restriction`，actual model=`gpt-5.5`。
- Same v0.1.13 process before failure：`gpt-5.6-sol` completed two native `image_generation_call` items。
- Product channel price allowlist：GPT-5.6 trio；no `gpt-5.5`。
- Focused frontend：5 files / 235 tests passed。
- Rust Account：118 passed、2 live tests ignored by design。
- `npm run typecheck`、target ESLint、`npm run doctor:strict`、runtime/engine contracts、`cargo check --lib` passed。
- `npm run check:large-files` report completed with exit 0；existing baseline debt remains informational。
- OpenSpec strict + docs + rustfmt/diff checks passed at implementation stage。
- Shared smoke `rollout-2026-08-31T06-39-38-...jsonl`：`turn_context.model=gpt-5.6-sol`、completed `image_generation_call` and non-empty PNG Base64 confirmed；canonical `turnCommitted.artifactRefs=[]`，UI only rendered “已生成黑毛 Doge”。
- Final Shared smoke：exact rollout completed image；physical PNG published under App Data `generated-images/shared/`；latest canonical `turnCommitted.artifactRefs` contains image media/hash/path/prompt；current timeline canonical refresh rendered generated-image card；exact preview allowlist fix resolved local image and visual acceptance passed。
- Upgrade behavior：revision-2 managed config migrates to revision 3 on exact engine prepare；Shared artifact code is release binary behavior over existing managed target/session identity，requires no config/login/session reset。
- Final automated L3：Rust focused account/artifact/coordinator/provider/preview/projection tests；frontend 6 files / 204 tests；target ESLint、TypeScript、Rust check、runtime/branding/docs/engine contracts、OpenSpec strict passed。Large-file report exit 0 with existing baseline debt only。

## Runtime Acceptance

- Quit packaged v0.1.13 so `npm run tauri:dev:hot` can own the single instance。
- Managed Native/Shared UI model、rollout `turn_context.model`=`gpt-5.6-sol` and completed `image_generation_call` verified。
- Shared local artifact、canonical ref、open-timeline refresh and image preview verified visually。
