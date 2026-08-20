## 1. 账号中心信息架构 [P0]

- [x] 1.1 [Input: authenticated Account controller; Output: subscription/usage tab state] 将 `overview` 迁移为 `subscription`，移除 security 主 Tab，并更新 Account Center tests。
- [x] 1.2 [Input: account subscription projection; Output: embedded subscription cards] 删除重复资料/我的引擎跳转，直接渲染订阅引擎与无二次导航。
- [x] 1.3 [Depends: 1.1] [Input: existing profile/password gateway calls; Output: Header commands] 实现显示名称原地编辑、确认/取消和 Header 密码 icon/tooltip；验证密码成功后回到登录态。

## 2. 首装引擎可见性 [P1]

- [x] 2.1 [Input: serialized AppSettings; Output: compatibility default] 在 `disabledCliEngines` 缺失时仅播种 Grok/Kimi/OpenCode；验证 explicit empty 与既有设置不被改写。
- [x] 2.2 [Depends: 2.1] [Input: Vendor Settings groups; Output: preserved manual enable path] 扩展 Rust/Frontend tests，确认新装默认分组及手动启用路径。

## 3. 质量与交付 [P0]

- [x] 3.1 [Depends: 1.1-1.3, 2.1-2.2] [Input: touched UI/settings code; Output: regression evidence] 运行 Account Experience、vendor visibility focused tests、typecheck、lint 与 OpenSpec strict validation。
- [x] 3.2 [Depends: 3.1] [Input: validated local build; Output: macOS DMG] 构建未签名本地 macOS arm64 包并记录绝对产物路径。
