# doge Product Identity Contract

## Scenario: canonical identity reaches every user-visible surface

### 1. Scope / Trigger

- Trigger: 修改产品名称、tagline、repository URL、bundle/package identity、About/Settings/native chrome、locale 或品牌视觉资产。
- 目标：普通用户只看到 lowercase `doge`；历史产品名称只能出现在兼容读取、法律历史或 developer-only upstream provenance。

### 2. Signatures

- Canonical manifest：`config/brand.json` → `BrandManifest`。
- Frontend constants：`DOGE_NAME`、`DOGE_TAGLINE`、`DOGE_REPOSITORY_URL`、`DOGE_ISSUES_URL`、`DOGE_COLORS`。
- Surface inventory：`config/brand-surfaces.json`。
- Static gate：`scanRepository(root, includePaths, allowlist)` 与 `verifyCanonicalIdentity(root)`。
- App links：About/Settings/Error/update surfaces MUST consume canonical doge URLs。

### 3. Contracts

- `config/brand.json` MUST own current name、version、repository、bundle、runtime、updater state、master icon path 与 color tokens。
- `package.json`、package lock、Cargo package/lib/bin、Tauri prod/dev identifiers MUST equal the manifest。
- User-facing product name MUST be lowercase `doge`；component copy MUST use i18n or canonical constants，禁止散落 hardcoded legacy brand。
- All 10 registered locales MUST expose the same required brand keys/placeholders；About MUST include localized doge tagline and AI Shiba story。
- Community/About support surfaces MUST use canonical doge repository/issue links；MUST NOT bundle or render upstream-owned QR codes、official-account copy、chat-group invitations or support contacts，即使这些内容本身不含 legacy product name。
- `scripts/check-branding.mjs` MUST scan renderer、Rust、Info.plist/InfoPlist.strings、release workflow、shipping scripts/configs 与 current README。
- Allowlist entry MUST contain exact path/line/token category、reason、removal condition；catch-all allowlist forbidden。
- Platform icons MUST derive from `brand.visual.appIconSource`；README icon、DMG、ICNS/ICO、Windows/iOS/Android matrix MUST remain present and dimension-checked。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 失败行为 |
|---|---|---|
| manifest 与 npm/Cargo/Tauri 不一致 | branding gate fail with field name | 静默选择任一来源 |
| shipping UI/Info.plist 出现旧品牌 | exact path/line negative test fail | 用 broad ignore 隐藏 |
| Community/About 出现 upstream-owned QR 或社群导流 | component/source/locale negative test fail | 因未出现旧品牌词而视为合规 |
| locale 缺 brand key/placeholder | locale inventory test fail | fallback 到旧 copy |
| compatibility reader 含旧 token | narrow allowlist + legacy fixture | 当作新写入继续扩散 |
| icon matrix 缺文件/尺寸错误 | icon contract fail | 发布时临时复用旧图标 |

### 5. Good / Base / Bad Cases

- Good：About title 用 `DOGE_NAME`，链接用 `DOGE_REPOSITORY_URL`，tagline/story 走当前 locale。
- Base：历史 localStorage key 仍可读，但 migration 后只写 `doge.*`。
- Bad：在组件、Info.plist、release workflow 中重新硬编码旧品牌或上游 repository。
- Bad：保留上游作者公众号、微信群二维码或类似 support asset，因为普通字符串品牌扫描无法识别其 ownership。

### 6. Tests Required

- `npx vitest run src/features/brand/contracts/*.test.ts src/features/brand/contracts/*.test.tsx`
- `CommunitySection.test.tsx` MUST assert localized doge story、canonical repository/issues clicks、no QR image and no upstream support copy；`userVisibleBrandInventory.test.ts` MUST scan all 10 locales for prohibited upstream support terms。
- `node --test scripts/lib/brandingChecker.test.mjs scripts/icon-assets.contract.test.mjs`
- `npm run check:branding && npm run typecheck && npm run lint`
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
