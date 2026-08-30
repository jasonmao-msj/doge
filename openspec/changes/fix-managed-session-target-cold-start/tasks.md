# Tasks

## 1. Contract and durable metadata

- [x] 1.1 建立本 change 的 proposal/design 与 L3 verification boundary。
- [x] 1.2 扩展 Rust/TypeScript session binding DTO，兼容旧 metadata JSON。
- [x] 1.3 让 send 与 continuation 持久化完整 execution target。
- [x] 1.4 让 session catalog 返回 durable target 并补 Rust metadata regression。

## 2. Renderer hydration

- [x] 2.1 解析 catalog target fields，按 durable > cache > default 顺序 hydration。
- [x] 2.2 保留旧 `selectedModelByThread.*` 读取兼容，并避免 cache 覆盖 durable target。
- [x] 2.3 明确用户选择的 immediate persistence 与 target canonicalization。
- [x] 2.4 补 `useSelectedComposerSession` 与 catalog parser focused regression。
- [x] 2.5 first-paint 无 catalog 时按 active native session 精确读取 durable target，并覆盖 daemon RPC。

## 3. Managed cold-start restore

- [x] 3.1 managed toolchain binary cache miss 时从现有 resolver 重新 resolve/verify。
- [x] 3.2 managed engine restore 使用 account activation，disk engine 才使用 generic switch。
- [x] 3.3 补 restore failure/stale target diagnostics 与 focused tests。

## 4. Verification

- [x] 4.1 affected Vitest、targeted ESLint、`npm run typecheck`。
- [x] 4.2 `npm run check:runtime-contracts`、Rust focused tests、`cargo check --lib`。
- [x] 4.3 更新 verification.md，记录 L3 命令与未覆盖的 L4 范围。
- [x] 4.4 补 targeted reader、reducer equality 与 daemon dispatch regression。
- [x] 4.5 补 Product Native alias overwrite regression：完整 target 写入后，旧兼容链路不得把真实 catalog id 覆盖为 runtime alias。
- [x] 4.6 补 Plan apply 的 effective session engine 传播，避免冷启动时按全局 GPT 执行已有 Kimi/managed session。

## 5. Shared Session cold-start correction

- [x] 5.1 `load_shared_session` / list projection 使用 Shared V2 durable target 优先于 legacy meta，read path 不写回。
- [x] 5.2 Shared target 为 null/partial 时禁止 Product automatic repair 持久化 default GPT。
- [x] 5.3 补齐 Layout 到 Composer 的 `selectedModelRuntime` 与 native target persistence callback 透传。
- [x] 5.4 补 Rust authority、Composer cold-start no-write、Layout props 与 history hydration regression。
- [x] 5.5 重新执行 L3 focused verification，并由用户完成 Windows 新 binary 真实 restart smoke。
