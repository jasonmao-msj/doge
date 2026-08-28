## 1. Trust plumbing（P0）

- [x] 1.1 定义 `nativeContextTrust` 读写 helper（缺字段 fail-closed → dirty）
- [x] 1.2 Failed / mark_recovery / rebuild / abandon → dirty
- [x] 1.3 非 zero-transfer accept / Completed → trusted
- [x] 1.4 unit：dirty 迁移 + legacy 缺字段 → dirty

## 2. Helpers（P0）

- [x] 2.1 `is_zero_transfer_package` + `session_needs_history`
- [x] 2.2 needs_history 在 destination-owned 全吞时仍 true

## 3. prepare_delivery rematerialize（P0）

- [x] 3.1 **dirty && needs_history → 一律 rematerialize**（不依赖 zero-transfer）
- [x] 3.2 响应 `rematerialized` / `nativeContextTrust`
- [x] 3.3 rematerialize 仍空 → 主前缀 `empty-context-handoff:`
- [x] 3.4 trusted 健康路径不强制 rematerialize

## 4. Review 查漏补缺（本轮）

- [x] 4.1 P0：continue-only 非空 package 回归测试
- [x] 4.2 P1：`persist_context_prepare_failure` 不吞 empty-context-handoff
- [x] 4.3 P1：FE classify + sharedSend i18n（zh/en + locale parity）
- [x] 4.4 P1：send 路径 `isKnownFailedTerminalError` 识别 empty-context-handoff
- [x] 4.5 P1：checkpoint 预算保留 earliest user，删中间轮
- [x] 4.6 design/spec 同步校准

## 5. Verification

- [x] 5.1 cargo：dirty_zero_transfer / dirty_non_zero_continue / mark_recovery dirty / missing field dirty + shared_context A-B-A 集成
- [x] 5.1b 修 interrupt route 多引擎 native id 期望（Kimi/Grok/OpenCode 前缀）以免阻断 shared_session_v2 验证
- [x] 5.2 手动冒烟：用户验收通过（2026-08-04）
- [x] 5.3 代码侧查漏补缺完成；单独 commit 收口

## 6. 查漏补缺结论（2026-08-04）

| 合同项 | 状态 |
|--------|------|
| Trust R/W fail-closed dirty | ✅ |
| Failed/recovery/rebuild/abandon → dirty | ✅ |
| Non-zero accept / Completed → trusted | ✅ |
| dirty && needs_history → rematerialize | ✅（不依赖 zero-transfer） |
| empty-context-handoff 主前缀 | ✅ backend + FE classify/i18n |
| trusted 不强制 rematerialize | ✅ |
| A-B-A destination-owned 回归 | ✅ shared_context 集成绿 |
| 手动 503 冒烟 | ⏳ 仅用户侧 |
