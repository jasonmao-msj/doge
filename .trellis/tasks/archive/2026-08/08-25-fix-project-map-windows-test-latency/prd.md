# 稳定 ProjectMap Windows 测试延迟并打双端包

## OpenSpec

- `stabilize-project-map-windows-test-latency`
- Branch: `codex/fix-project-map-windows-timeout`
- Base: `main@e57c4e72e`

## Acceptance

1. 不提高 timeout；leaf disclosure test 不挂载完整 ProjectMapPanel。
2. Project Map focused tests、ESLint、typecheck、OpenSpec/docs gates 通过。
3. push branch并创建 PR。
4. release workflow 产出 Windows unsigned NSIS、macOS aarch64/x86_64 ad-hoc DMG 及 checksums。
5. workflow 监控交给 `gpt-5.6-luna` subagent。
