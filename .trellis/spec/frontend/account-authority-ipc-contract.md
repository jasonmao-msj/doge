# Account Authority IPC Contract

## Scenario: Native success envelope survives renderer SafeLabel validation

### 1. Scope / Trigger

- Trigger：修改 `src-tauri/src/account/**` response projection、`src/services/accountGateway.ts`、`src/features/account/contracts/ipcSchemas.ts` / `ipcValidator.ts` / `safeValues.ts`，或 Account UI 展示 profile/email label。
- 目标：Rust 已完成 Authority mutation、Keychain 与 SQLite commit 后，renderer MUST 对同一 canonical safe payload 得出 success；不得因 presentation validator 漂移把 durable success 误报为 `protocolMismatch`。

### 2. Signatures

- Native login result：`auth.login -> { next: "authenticated", session: AuthenticatedSessionV1 }`。
- Session fields：`status`、`accountEpoch`、`sessionCapability`、`profileLabel`、`primaryEmailLabel`。
- Renderer boundary：`validateAccountIpcResponseV1(value, context)`。
- Field validator：`validateSafeLabelForFieldV1(field, value)`。
- Masked email example：`primaryEmailLabel = "a***@token-matrix.com"`。

### 3. Contracts

- `primaryEmailLabel` MUST 使用 field-specific allowlist，接受 bounded Unicode letters/digits、space、`._()@*+-`，总长度 `1..80`，且首字符为 letter/digit。
- 其他 SafeLabel field MUST 继续使用 generic allowlist；不得因 email 展示需求全局放宽 `@`/`*`。
- 所有 field 仍 MUST 经过 URI scheme、forbidden Account value/field 与 recursive safe-artifact 检查。
- `protocolMismatch` 只能表示真实 contract/correlation failure；不得由 Rust 已成功持久化的 allowlisted presentation label 触发。
- 用户主阅读路径 MUST 显示 localized actionable copy；stable diagnostic code 只能放在 `AccountHelpTooltip` progressive disclosure 中。

### 4. Validation & Error Matrix

| 输入 / 状态 | 必须行为 | 禁止行为 |
|---|---|---|
| `primaryEmailLabel="a***@token-matrix.com"` | login/bootstrap IPC success | generic pattern 先拒绝后伪报 `protocolMismatch` |
| `primaryEmailLabel="admin@token-matrix.com"` | bounded safe label | 当作 URI 或 raw secret |
| generic `targetLabel="a***@host"` | 继续拒绝 | 为 email 放宽全部 SafeLabel |
| `https://token-matrix.com` / private path | 拒绝 | 绕过 URI/path corpus |
| wrong password | `credentialsRejected` localized message | `protocolMismatch` |
| true malformed IPC envelope | fail closed + help tooltip diagnostic | raw code 作为主要文案 |

### 5. Good / Base / Bad Cases

- Good：native `auth.login` success response 带 masked email，通过 `validateAccountIpcResponseV1` 并进入 authenticated Account center。
- Base：`primaryEmailLabel=null` 保持合法；profile label 继续走 generic pattern。
- Bad：先无条件执行 `SAFE_LABEL_PATTERN_V1`，再额外执行 primary-email regex；第一次失败无法被第二次检查挽回。
- Bad：把 `@`、`*` 加进 global generic pattern，扩大 URL/identifier presentation surface。

### 6. Tests Required

- `src/features/account/contracts/accountContracts.test.ts` MUST 构造完整 `auth.login` mutation response，并断言 masked `primaryEmailLabel` 通过 correlation + runtime schema + privacy validation。
- 同一 suite MUST 保留 URI/path/forbidden value negative corpus。
- `src/features/account/components/AccountExperience.test.tsx` MUST 断言 actionable failure copy 可见、raw code 不在 primary content、tooltip 可通过 keyboard focus 查看 diagnostic。
- Required commands：`npm exec vitest run -- src/features/account`、`npm run typecheck`、`npm run lint`、`npm run check:runtime-contracts`。

### 7. Wrong vs Correct

#### Wrong

```ts
if (!SAFE_LABEL_PATTERN_V1.test(value)) reject();
if (field === "primaryEmailLabel" && !MASKED_EMAIL_PATTERN.test(value)) reject();
```

#### Correct

```ts
const pattern = field === "primaryEmailLabel"
  ? PRIMARY_EMAIL_LABEL_PATTERN_V1
  : SAFE_LABEL_PATTERN_V1;
if (!pattern.test(value)) reject();
```
