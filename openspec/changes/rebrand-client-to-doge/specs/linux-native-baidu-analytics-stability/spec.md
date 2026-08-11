## REMOVED Requirements

### Requirement: Linux native analytics MUST bypass the unsafe WebKit network path without disabling PV/UV

**Reason**: doge 不拥有上游 Baidu Tongji property，继续发送 PV/UV 会把 doge 用户流量交给上游；本 change 在所有平台移除该 analytics feature，而不是维护 Linux transport workaround。

**Migration**: 删除 renderer injection、Linux native bridge、Rust commands、site id 与 CSP allowlist；不替换为新 telemetry。

### Requirement: Native analytics transport MUST preserve visitor identity and request facts

**Reason**: doge 不再发送 Baidu analytics，因此不再需要 HMACCOUNT、visitor-cookie 或 beacon request fact persistence。

**Migration**: 停止读取/写入 Baidu visitor state；已存在的旧 analytics file 不上传、不迁移，可由后续 housekeeping change 安全清理。

### Requirement: Native analytics commands MUST remain a narrow fixed-purpose boundary

**Reason**: doge shipping runtime 不应保留 disabled-but-callable upstream analytics proxy 或 script loader。

**Migration**: 从 Tauri command registry、frontend wrappers、Rust state 与 tests 删除 Baidu commands；不提供 generic replacement proxy。

### Requirement: Unaffected analytics runtimes MUST retain existing behavior

**Reason**: Windows、macOS 与 Web Service 同样不得继续使用上游 Baidu site id；不存在需要保留的 doge analytics runtime。

**Migration**: 所有 production/development/secondary-window 分支统一为“不初始化 Baidu analytics”。

### Requirement: Linux release verification MUST prove both analytics delivery and a visible stable renderer

**Reason**: analytics delivery 不再是 doge release acceptance；renderer 可见性与 Linux startup stability 仍由独立 Linux startup capabilities 验证。

**Migration**: 删除 PV/UV、`hca`、cookie reuse evidence；保留 direct ELF/AppImage/launcher 的 renderer-ready、screenshot 与 crash evidence 到 canonical Linux startup verification。
