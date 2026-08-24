# Tasks

## 1. Explore / Propose

- [x] 1.1 校准 PRD、交互原型、现有 Doge account/runtime/model picker 与 token2api `origin/main` Composite/payment/key/models 能力。
- [x] 1.2 确认本轮不修改 token2api schema、payment fulfillment 或生产服务；记录 generic API 复用与风险边界。
- [x] 1.3 建立 proposal、design、spec deltas，并更新 PRD 中已失效的 Approach A/C 判断。

## 2. Native product authority

- [x] 2.1 增加 product catalog/entitlement/checkout/prepare/model catalog 严格 contract，并注册 gateway operations/capabilities。
- [x] 2.2 复用 generic token2api checkout、subscription、key/handoff 与 Composite `/v1/models`；实现 idempotent managed key 与 OS vault 投影。
- [x] 2.3 将 managed Composite provider 投影到 Codex、Claude、Kimi 的新会话默认配置，保留 local/expert channel。
- [x] 2.4 增加 cooldown、in-flight dedupe、TTL cache 与 secret-safe logging/tests。

## 3. Frontend Gate and catalog

- [x] 3.1 将 AccountAppGate 改为 product-scoped state machine，移除启动时 engine choice，未 ready 前全屏阻断 AppShell。
- [x] 3.2 套餐与支付 UI 只消费 upstream-owned plan/method/checkout 字段，保留 logout/switch account 与错误恢复。
- [x] 3.3 建立 product entitlement/model catalog store，为 composer/account center 提供单一客户端 projection。

## 4. Composer engine/model panel

- [x] 4.1 将 ModelSelect 主路径改为 Doge 原生右侧 side panel，engine 与 model 分区单选，model 支持搜索和 vendor grouping。
- [x] 4.2 engine/model 状态独立且选择立即生效、面板保持打开；composer 同时显示 engine/model icon 与 model name。
- [x] 4.3 保留非 product/local expert fallback，并补 independent-selection/regression tests。

## 5. Account center

- [x] 5.1 Subscription surface 初版改为单 product card、到期日、model count 与永久可见模型列表；模型列表交互后由 §16.12 收口为 vendor count 渐进展开。
- [x] 5.2 Usage surface 改为 product/model projection，移除 legacy engine-scoped fallback。
- [ ] 5.3 Account shortcut 改为整数 percentage preview→detail 动线；保留显示名、密码、安全、身份绑定和退出登录。（待按 product store 实码验收）

## 6. Verify / Run

- [x] 6.1 运行 OpenSpec strict validate、affected Vitest/typecheck、Rust account/runtime focused tests 与 contract checks。
- [x] 6.2 检查跨层 contract、请求风暴与 secret redaction；记录未覆盖平台/场景。
- [x] 6.3 使用日常入口 `npm run tauri:dev:hot` 启动 Doge，确认无 Keychain 阻塞并完成真实账号用户体验验收。

## 7. Hot feedback fixes

- [x] 7.1 修复 Kimi managed provider JSON registry 被误用 Codex TOML 规则校验、导致 product preparation 回滚的问题。
- [x] 7.2 将 preparation failure 收敛为一条 cause-specific message 与 retry action，移除重复标题、重复错误和装饰 icon。
- [x] 7.3 增加 Kimi configuration verification regression test，并执行 L2 focused verification。
- [x] 7.4 将 engine selector 收敛为完整名称的紧凑行，并把 product model catalog 改为 presentation vendor grouping。
- [x] 7.5 让 Account Center 的 product model details 复用同一 vendor grouping，并展示 model brand icon。
- [x] 7.6 历史步骤：曾将 product model details 改为永久展开，并在 product-ready Usage tab 移除旧 engine-scoped subscription/analytics 分支；永久展开已由 §16.12 supersede。
- [x] 7.7 **Corrected by §16.1**：曾将 `豆包` display alias 静态改写为 `ark-code-latest`；只读 production/source 审计证明该右值是 admin-only account mapping，动态实现必须撤销该猜测并只消费公开 catalog call identity。
- [x] 7.8 将 product-ready provider 从 UI 默认值提升为 Composer/发送 contract：初始化、Shared repair 与 engine/model 切换统一绑定 `doge-token-matrix`，并移除 product flow 的 configuration 选择语义。
- [x] 7.9 将 Codex `turn/completed` 中的 failed terminal status 投影为 `turn/error` 语义，避免 upstream 5xx 被误结算成无响应，并补 focused regression。
- [x] 7.10 将 product-ready Home/create-session target 接入 Composer 与实际发送链：engine/model 切换强制归一为 `doge-token-matrix`，并将 Kimi `kimi-code/<id>` display catalog identity 映射为 raw runtime model id；Shared repair 与 configuration selector 收口仍保留在 7.8。

## 8. Product 后端接线补全（2026-08-23）

> 核对发现 §2 多项在代码中实际未接线（`runtime_product.rs` 未声明编译、authority product 方法缺失、IPC 命令未注册、kimi 托管链路断点）。本节记录补全过程。

- [x] 8.1 authority 层新增 product wire 类型与已部署 panel 端点方法：`GET /api/v1/payment/checkout-info`、`POST /api/v1/payment/orders`（Idempotency-Key）、`GET /api/v1/payment/orders/{id}`、`GET /api/v1/keys?group_id=`、`POST /api/v1/keys`（Idempotency-Key，one-time secret 经 `key` alias）、gateway `/v1/models`（Bearer secret，非 envelope 解析）。
- [x] 8.2 `account/runtime.rs` 声明 `mod runtime_product;`；`runtime_ipc.rs` 与 `command_registry.rs` 注册 `account_product_v1_{catalog,create_checkout,checkout,pending_checkout,abandon_checkout,prepare}`；`router.tsx` 挂载 `ProductAccountAppGate`。
- [x] 8.3 kimi 托管链路补全：vault allowlist 增加 `managed-engine:kimi:`；`valid_managed_engine` 与 `managed_engine_key_for_launch` 支持 `"kimi"`；`configuration.rs` 新增 kimi plan/verify 分支（`build_doge_config_for_kimi` 不落 apiKey，verify 校验 secret-safe）；launch 时 `hydrate_managed_kimi_provider_home` 从 OS vault 注入 api_key 到隔离 provider home（owner-only）。
- [x] 8.4 kimi config.toml 生成正确性修复：`models` 同时写入裸 model id 别名（CLI 以 `--model <raw id>` 解析，仅 `doge/<model>` 别名会触发创建失败→telemetry crash 掩盖真实错误）与旧 `doge/<model>` 别名；`max_context_size` 缺省兜底 128000（kimi-code 硬校验）；托管条目 baseUrl 固定携带 `/v1`。
- [x] 8.5 Kimi 异步发送路径对齐同步变体的 `vendors.kimi.current` 回退，使 product prepare 投影的托管默认在新会话直接生效。

## 9. 验收缺陷修复（2026-08-23）

- [x] 9.1 修复 generic checkout-info plan wire 与 frontend `parseProductCatalog` 的 mandatory field mismatch；增加真实 upstream fixture contract test。
- [x] 9.2 Kimi hydration 按当前 runtime model 增量写 bare + `doge/` aliases，覆盖非默认 product model，保持 selected durable vault secret 与 owner-only config。
- [x] 9.3 保留 checkout 首次返回的 payment action，poll response 未携带 action 时不得让“重新打开支付”在同 session 消失。
- [x] 9.4 验收 macOS stable local signing：setup 幂等、shell syntax、Node contract、actual codesign/designated requirement；明确其非 release/Gatekeeper signing。

## 10. 单页账户详情与渐进加载（2026-08-23）

- [x] 10.1 增加 product usage read-only Native contract：closed period、active Composite revalidation、subscription window range、parallel stats/snapshot、strict/safe projection。
- [x] 10.2 增加 product billing read-only Native contract：subscription order list + plan mapping，safe rows，no invoice artifact claim。
- [x] 10.3 增加 Tauri service/parser/hook，usage 与 billing 独立 async owner、in-flight dedupe、generation guard、last-known-good 与 section retry。
- [x] 10.4 Account Center 实现原型信息层级的单页布局：profile/status、四项 stats、quota meter、engine unavailable roster、model TOP、billing、subscription/model details；保留 account lifecycle controls。
- [x] 10.5 补 component/client/Rust tests，运行 L3 focused verification 与 OpenSpec strict validate。
- [ ] 10.6 首次 debug 登录后完成真实账户详情的 dark/light/narrow visual QA；当前 credential file 为空，不能用 Keychain fallback 伪造验收。

## 11. macOS debug local vault（2026-08-23）

- [x] 11.1 在 `DurableAccountVault` selection boundary 增加 `macOS + debug_assertions` file vault；Release 与其他 build 保持 `OsAccountVault`。
- [x] 11.2 复用 purpose allowlist，落实 repo 外 app-data、directory `0700`、file `0600`、symlink rejection、bounded parse、lock + secure atomic write 与 secret-safe errors。
- [x] 11.3 增加 read/write/delete/corruption/permission/symlink/selector focused tests；证明 debug selector 不访问 Keychain。
- [x] 11.4 用标准 `npm run tauri:dev:hot` 冷启动并重启，确认两次均无 Keychain / SecurityAgent authorization。
- [x] 11.5 用户完成一次正常 debug 登录后，验证真实 session 与 managed Codex/Claude/Kimi credential 可从 local vault 跨重启恢复。

## 12. Product Gate 实机样式缺口（2026-08-23）

- [x] 12.1 将 `account-app-gate.css` ownership 从 legacy `AccountAppGate.tsx` 移到共享 `AccountAppGateViews.tsx`，使 Product Gate bundle graph 必然包含样式。
- [x] 12.2 为 Gate Doge logo 增加 `54×54` intrinsic dimensions，避免 CSS settle 前按原始 raster 铺满窗口。
- [x] 12.3 增加 static visual contract，覆盖 shared stylesheet owner、sibling consumer omission 与 logo bounds；在当前源码 QA app 中目视确认登录页恢复。

## 13. 支付履约推进与套餐卡视觉（2026-08-23）

- [x] 13.1 Product Gate 增加 `fulfilling` phase：paid 后 forced catalog refresh + bounded backoff，entitlement active 后自动 prepare/ready，延迟或失败时不退回购买页。
- [x] 13.2 Native 将 paid order 保存为 credential-free fulfillment checkpoint，并在 restart 的 pending checkout read 中恢复 paid truth；prepare success 后清理 checkpoint。
- [x] 13.3 套餐页按原型重做 structured plan card：plan header/price/validity、engine row、upstream feature/model row、full-width CTA；补 dark/narrow 样式。
- [x] 13.4 增加 frontend deferred reconciliation tests、Rust checkout persistence tests、visual contract 与当前账号实机回归。
- [x] 13.5 修复 `verify_applied_plan` 将 Kimi JSON registry 误走 Codex TOML verifier 的分支；managed merge 清理 legacy secret fields，并补 focused regression。

## 14. Engine × Model 自由组合（2026-08-23）

- [x] 14.1 研究 Codex Responses、Claude Messages、Kimi Chat Completions 三条 runtime/wire path，并用真实套餐 key 运行 3×7 最小 protocol matrix；记录 production Messages gate 与 GPT account-pool 前置。
- [x] 14.2 接入 product 专用右侧 engine/model panel：统一 product model catalog、独立选择、搜索/vendor grouping、engine+model icons，隐藏 provider/config controls。
- [x] 14.3 Home create-session 与 Shared Next Turn 统一生成 `doge-token-matrix` target；切 engine 保留 model、切 model 保留 engine，existing Native 继续走 immutable binding/Continuation。
- [x] 14.4 删除 product surface 对 provider-scoped/local model catalog 的依赖与预取，补 catalog-id/runtime-model separation、no silent fallback tests。
- [ ] 14.5 **Superseded by §15**：21/21 Cartesian matrix 不再作为初版 closure gate；已证实红 cell 不得继续显示为可选能力。
- [ ] 14.6 **Deferred**：token2api Composite Messages dispatch 与跨协议 adapter 改造留作后续扩展，不阻塞 engine-specific 初版。

## 15. Engine-specific 初版模型矩阵（2026-08-23，已由 §16 supersede）

- [x] 15.1 复核生产账号池、Composite group、Channel pricing、模型白名单与真实 CLI evidence：确认 `Doge APP` 只属于 Kimi Channel 是 GPT 503 的配置根因；Claude account 支持 6 个模型但当前只将有成功记录的 `claude-sonnet-4-6` 标绿；Kimi highspeed 真实 CLI 因 namespaced runtime model 404，暂不开放。
- [x] 15.2 将 product picker/target repair 改为消费共享 engine compatibility matrix：Codex 5 GPT、Claude Code 1 Claude、Kimi 1 Kimi；切 engine 时只在当前 model 不兼容时原子 fallback，空交集 fail closed。
- [x] 15.3 以 `config/product-engine-model-compatibility.json` 作为 frontend/Native SSOT，收敛 product model projection 为 7 个初版 release models，加入 `claude-sonnet-4-6` 并移除未验收的 `kimi-for-coding-highspeed`。
- [ ] 15.4 **Superseded by §16**：不再把 production catalog 固定为 7 个 model ids；保留只读上游审计和 route prerequisite evidence。
- [x] 15.5 执行本地 L3 focused tests、typecheck、target ESLint、Rust focused tests、`cargo check --lib`、runtime contracts、OpenSpec strict validation与 standard hot-dev Vite connection smoke。
- [ ] 15.6 **Superseded by §16**：真实 CLI smoke 改为当前动态 conversation catalog 与 selected target evidence，不再以 7-cell manifest 为完成口径。

## 16. Dynamic product model catalog and full E2E（2026-08-23）

- [x] 16.1 只读复核 token2api production 与 source：`/v1/models` 动态返回 `id + display_name`，但不暴露账号私有 `model_mapping` 右值；`豆包 -> ark-code-latest` 属于 admin-only routing fact，Doge 不得依赖。
- [x] 16.2 扩展 Native model wire/projection 为 `id + display_name + model/runtime_model + compatible_engines + capabilities`；保留上游顺序、拒绝 malformed/non-conversation rows，并增加只读 `account_product_v1_models` refresh command。
- [x] 16.3 删除 `config/product-engine-model-compatibility.json` exact-id manifest；Frontend 直接消费动态 compatible rows，显示 `displayName`、发送 `model`、持久化 `id`。
- [x] 16.4 增加 catalog refresh coordinator：30s freshness、single in-flight、window focus/visibility + 60s fallback、manual refresh、last-known-good 与 stale/error UX。
- [x] 16.5 接入 product engine provisioning：Codex/Claude 自动解析 verified bundled/external toolchain，Kimi 缺失时 typed install + doctor/version recheck；之后确认三 engine runtime model projection 支持安全 Unicode/新模型且不回退 global/default。
- [ ] 16.6 使用 exact `npm run tauri:dev:hot` 完成登录/订阅恢复、三引擎自动安装/配置、动态模型刷新、display/runtime identity、每个当前可选组合的真实发送 terminal E2E；记录 upstream/config blockers。
- [ ] 16.7 执行用户要求的 L4：全量 Vitest、全量 Rust tests、lint、typecheck、contracts、build、OpenSpec、界面目视矩阵；修复所有本次相关 failure。
- [x] 16.8 按 account/runtime、dynamic catalog/picker、docs/tests 分类提交，执行 Trellis session record，push `codex/*` branch 并创建未合并 Doge PR #19。
- [x] 16.9 修复 `tauri:dev:hot` dev flavor / `devUrl` 漂移：显式加载 `tauri.dev.conf.json`，统一 Vite `1420`，增加 branding 与 dev startup contract，避免 UI 验收误连 stale bundle。
- [x] 16.10 经用户授权保存并重开复核 7 条 production Composite routes；真实 CLI 证明 Kimi route 成功，Claude/GPT/豆包被 `Doge APP` 单一 Kimi pricing channel 拒绝，未擅自修改 pricing。
- [x] 16.11 改进 Account bootstrap 错误态：修复全屏 Gate 遮挡 Tooltip 的 stacking contract；问号支持 hover/focus 说明与 click/keyboard 展开，详情只展示 validated closed failure 的 code/stage/recovery action，并可再次收起。
- [x] 16.12 收口四项 hot UI feedback：product model panel 移除 ready footer；普通 Native conversation 复用仅 Codex/Claude/Kimi 的 product panel 并固定 `doge-token-matrix`；账单移除 invoice 提示；Account 模型按 vendor count 渐进展开/收起。
- [x] 16.13 将 managed provider display name 从 `Doge Token Matrix` 统一迁移为 `Doge`（stable id 不变，authenticated prepare 幂等覆盖旧配置），并让所有豆包 identity 统一使用用户提供的 `src/assets/model-icons/doubao.png`。
