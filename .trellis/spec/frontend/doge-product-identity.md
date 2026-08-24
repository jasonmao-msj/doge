# doge Product Identity Contract

## Scenario: canonical identity reaches every user-visible surface

### 1. Scope / Trigger

- Trigger: 修改产品名称、tagline、repository URL、bundle/package identity、About/Settings/native chrome、locale 或品牌视觉资产。
- 目标：普通用户只看到 lowercase `doge`；历史产品名称只能出现在兼容读取、法律历史或 developer-only upstream provenance。

### 2. Signatures

- Canonical manifest：`config/brand.json` → `BrandManifest`。
- Canonical Tauri startup：`package.json#tauri:dev:hot = "tauri dev"` → `src-tauri/tauri.conf.json`。
- Debug credential isolation：`cfg(all(debug_assertions, target_os = "macos"))` → app-data `debug-account-vault/credentials.json`；不依赖第二个 bundle identifier。
- Frontend constants：`DOGE_NAME`、`DOGE_TAGLINE`、`DOGE_REPOSITORY_URL`、`DOGE_ISSUES_URL`、`DOGE_COLORS`。
- Surface inventory：`config/brand-surfaces.json`。
- Static gate：`scanRepository(root, includePaths, allowlist)` 与 `verifyCanonicalIdentity(root)`。
- App links：About/Settings/Error/update surfaces MUST consume canonical doge URLs。
- App icon boundary：`sanitizeDockIconId(input): DockIconId`、`resolveDockIconSrc(input): string`、`applyDockIconPreference(input): Promise<void>`。

### 3. Contracts

- `config/brand.json` MUST own current name、version、repository、bundle、runtime、updater state、master icon path 与 color tokens。
- `package.json`、package lock、Cargo package/lib/bin 与 canonical Tauri identifier MUST equal the manifest。
- 所有 macOS development commands（hot、isolated、signed）MUST 继承 canonical `productName=doge` 与 `identifier=io.github.jasonmao-msj.doge`；MUST NOT 引入 `tauri.dev.conf.json`、`doge-dev` 或第二套 app-data identity。
- Debug/Release credential backend isolation MUST 由 compile-time vault selector 实现；MUST NOT 通过可见 app flavor 隔离。macOS debug 继续使用 file vault，Release 继续使用 OS vault。
- Hot App QA MUST 核对当前进程为 repo `target/debug/doge`，并验证其打开 canonical bundle app-data。自动化 MUST NOT 通过 bundle id 启动 `target/**/bundle/macos/*.app` 代替正在运行的 raw `tauri dev` process；该行为可能唤起 stale bundle。
- User-facing product name MUST be lowercase `doge`；component copy MUST use i18n or canonical constants，禁止散落 hardcoded legacy brand。
- All 10 registered locales MUST expose the same required brand keys/placeholders；About MUST include localized doge tagline and AI Shiba story。
- Community/About support surfaces MUST use canonical doge repository/issue links；MUST NOT bundle or render upstream-owned QR codes、official-account copy、chat-group invitations or support contacts，即使这些内容本身不含 legacy product name。
- `scripts/check-branding.mjs` MUST scan renderer、Rust、Info.plist/InfoPlist.strings、release workflow、shipping scripts/configs 与 current README。
- Allowlist entry MUST contain exact path/line/token category、reason、removal condition；catch-all allowlist forbidden。
- Platform icons MUST derive from `brand.visual.appIconSource`；README icon、DMG、ICNS/ICO、Windows/iOS/Android matrix MUST remain present and dimension-checked。
- Settings MUST NOT expose an alternate app/Dock icon selector；doge ships one canonical visual identity。Persisted legacy `dockIconId` values MAY remain accepted as compatibility input, but MUST normalize to `default` and MUST NOT select or bundle a legacy runtime icon。
- Shipping renderer surfaces and the runtime `default` Dock icon MUST resolve the canonical Doge product asset；feature UI MUST NOT reintroduce legacy `src/assets/icon.png` imagery or ship a second default visual identity。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 失败行为 |
|---|---|---|
| manifest 与 npm/Cargo/Tauri 不一致 | branding gate fail with field name | 静默选择任一来源 |
| hot command 引入 dev overlay/name/identifier | startup contract 与 branding gate fail | 启动第二套 product/app-data state |
| debug credentials 需要隔离 | compile-time file vault；同一 doge identity | 创建 `doge-dev` bundle 或回退 Keychain |
| App QA 发现多个 bundle candidate | 对账 repo process + canonical app-data；拒绝 stale bundle | 按 bundle id 自动启动任一旧 `.app` |
| shipping UI/Info.plist 出现旧品牌 | exact path/line negative test fail | 用 broad ignore 隐藏 |
| Community/About 出现 upstream-owned QR 或社群导流 | component/source/locale negative test fail | 因未出现旧品牌词而视为合规 |
| locale 缺 brand key/placeholder | locale inventory test fail | fallback 到旧 copy |
| compatibility reader 含旧 token | narrow allowlist + legacy fixture | 当作新写入继续扩散 |
| icon matrix 缺文件/尺寸错误 | icon contract fail | 发布时临时复用旧图标 |
| Appearance settings 渲染备用应用图标选择器 | SettingsView regression fail | 允许用户恢复上游视觉身份 |
| feature UI / runtime default Dock 使用不同产品图标 | visual contract fail；统一到 canonical product asset | 在 feature 内直接 import legacy icon |

### 5. Good / Base / Bad Cases

- Good：About title 用 `DOGE_NAME`，链接用 `DOGE_REPOSITORY_URL`，tagline/story 走当前 locale。
- Good：`npm run tauri:dev:hot` 展开为 `tauri dev`，进程为 `target/debug/doge`，app-data 为 `io.github.jasonmao-msj.doge`，debug vault 仍不访问 Keychain。
- Good：`resolveDockIconSrc("multi-orbit-hub")` 与 `resolveDockIconSrc("default")` 返回同一 canonical doge asset；native refresh 只发送 `iconId: "default"`。
- Base：历史 localStorage key 仍可读，但 migration 后只写 `doge.*`。
- Base：旧版本写入的 `dockIconId` 仍可由启动兼容层读取，但 Appearance 不渲染选择器。
- Bad：在组件、Info.plist、release workflow 中重新硬编码旧品牌或上游 repository。
- Bad：为避免 debug Keychain 授权创建 `doge-dev` / `.dev` bundle identifier；这会把登录态、订阅态、设置和 UI 验收分叉成第二套产品事实。
- Bad：Computer Use 通过 bundle id 唤起 `target/debug/bundle/macos/doge.app` 并把它当作当前 `tauri dev` 进程验收。
- Bad：按 persisted `dockIconId` 重新 import、render 或 apply `src/assets/dock-icons/**` 中的历史图标。
- Bad：保留上游作者公众号、微信群二维码或类似 support asset，因为普通字符串品牌扫描无法识别其 ownership。

### 6. Tests Required

- `npx vitest run src/features/brand/contracts/*.test.ts src/features/brand/contracts/*.test.tsx`
- `CommunitySection.test.tsx` MUST assert localized doge story、canonical repository/issues clicks、no QR image and no upstream support copy；`userVisibleBrandInventory.test.ts` MUST scan all 10 locales for prohibited upstream support terms。
- `node --test scripts/lib/brandingChecker.test.mjs scripts/icon-assets.contract.test.mjs`
- `node --test scripts/tauri-dev-resources.test.mjs scripts/macos-dev-signing.contract.test.mjs` MUST assert hot command 无 dev overlay、canonical name/identifier、signed runner canonical identifier。
- `npm run check:branding && npm run typecheck && npm run lint`
- macOS smoke MUST assert `ps` 仅有 repo `target/debug/doge`（无 `doge-dev.app`），并用 open-file evidence（例如 `lsof`）确认 canonical app-data；debug vault file/directory modes 分别为 `0600` / `0700`。
- `npx vitest run src/features/settings/components/SettingsView.test.tsx`
- `npx vitest run src/features/theme/utils/dockIcon.test.ts src/features/settings/hooks/useAppSettings.test.ts`
- Icon assertion points：master/source RGBA、1024/512/32/128、ICNS/ICO、Square/iOS/Android、DMG 1x/2x、README reference。

### 7. Wrong vs Correct

#### Wrong

```tsx
<button onClick={() => openUrl("https://github.com/old-owner/old-product")}>GitHub</button>
```

#### Correct

```tsx
import { DOGE_REPOSITORY_URL } from "../../../config/brand";

<button onClick={() => openUrl(DOGE_REPOSITORY_URL)}>{t("about.github")}</button>
```

#### Wrong: persisted preference restores a legacy visual identity

```ts
const src = legacyIconById[sanitizeDockIconId(settings.dockIconId)];
await setDockIcon({ iconId: settings.dockIconId, pngBytes: await load(src) });
```

#### Correct: compatibility input collapses to the canonical doge icon

```ts
const iconId = sanitizeDockIconId(settings.dockIconId); // always "default"
const src = resolveDockIconSrc(iconId); // canonical doge appIconSource
await setDockIcon({ iconId, pngBytes: await load(src) });
```

#### Wrong: dev overlay creates a second product state

```json
{
  "productName": "doge-dev",
  "identifier": "io.github.jasonmao-msj.doge.dev"
}
```

#### Correct: every dev command inherits the canonical manifest

```json
{
  "scripts": {
    "tauri:dev:hot": "tauri dev"
  }
}
```

Debug secrets remain isolated by the compile-time file-vault selector, not by a second Tauri identity.
