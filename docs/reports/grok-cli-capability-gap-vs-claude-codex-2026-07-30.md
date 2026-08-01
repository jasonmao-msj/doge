# 多 CLI 图片输入能力对齐（以代码为准，2026-07-30）

> **2026-08-01 生命周期校准**：implemented；OpenSpec `grok-cli-image-input-capability-gap` 为 `25/25`，仍 active，待 verify / sync / archive。当前 capability 以 generated matrix 与 `pnpm check:engine-capability-matrix` 为准。

## 一、结论

用户侧 `image content omitted because you do not support image input` **不是**「附件字段没带过去」的简单 bug，也**不是**「Grok/Kimi 模型天生不能看图」。

根因是 mossx 早期对部分 CLI 只走了**纯文本 prompt**，忽略 `images`，并把 matrix 误标为 `unsupported`。

**当前代码状态（已验收）**：

| Engine | `image.input` | 发送 transport | 幕布展示 |
|---|---|---|---|
| Claude | supported | 既有 stream-json / content 多模态 | 既有 |
| Codex | supported | `turn/start.input` image item；sync 走 `params_to_codex_input` | 既有 |
| Gemini | supported | 既有 path 注入 | 既有 |
| **Grok** | **supported** | 有图：`--prompt-file` ACP `{type:image,mimeType,data}`（staging JSON，避 ARG_MAX）；无图：`-p` | 历史剥离 `<image_files>` / `<user_query>`，路径进 `images[]` + LocalImage |
| **Kimi** | **supported** | headless `-p`：注入绝对路径 + `<image path>` + ReadMediaFile 指令（print mode `permission: auto`） | 历史 loader 剥离注入 marker，路径进 `images[]` |
| **OpenCode** | **supported** | `opencode run -f <abs-path>` | 路径直挂 |

Claude / Codex 既有发图路径**未改 transport**。

---

## 二、能力矩阵（代码事实）

来源：

- Rust：`EngineFeatures::{claude,codex,gemini,grok,kimi,opencode}().image_input`
- Fixture：`openspec/specs/engine-capability-matrix/fixtures/matrix.json`
- 生成物：`capability_matrix.generated.rs` / `engineCapabilityMatrix.generated.ts`

当前 **六个 engine 的 `image.input` 均为 `supported`**。
语义差异在 transport，不在「能不能贴图」：

- **Grok**：inline base64 ACP（首包视觉）
- **OpenCode**：CLI 文件附件
- **Kimi**：路径 + agent `ReadMediaFile`（非 Grok 级首包 inline）

---

## 三、发送链路（code map）

```text
Composer attachments (path | data URL | file://)
  -> useThreadMessaging.sanitizeImageAttachmentPaths
  -> matrix gate (engineSupportsImageInput；当前全 supported，门禁 no-op)
  -> engine_send_message / _sync(images)
       Claude / Codex / Gemini : 既有
       Grok     : build_grok_prompt_json -> --prompt-file | -p
       OpenCode : resolve_existing_image_files -> run --file ...
       Kimi     : resolve_existing_image_files -> build_kimi_prompt_with_images -> -p
  -> UI bubble: visibleUserText + images[]（不含 CLI 私有注入）
  -> History reload:
       Grok: parse_grok_user_prompt_for_display
       Kimi: split_kimi_prompt_for_display
  -> MessageImageGrid: convertFileSrc + LocalImage(localPath, workspaceId)
```

### 关键文件

| 层 | 路径 |
|---|---|
| Shared resolve | `src-tauri/src/engine/cli_image_input.rs` |
| Grok send | `src-tauri/src/engine/grok.rs` |
| Grok history | `src-tauri/src/engine/grok_history.rs` |
| Kimi send | `src-tauri/src/engine/kimi.rs` |
| Kimi history | `src-tauri/src/engine/kimi_history.rs` |
| OpenCode send | `src-tauri/src/engine/opencode.rs` |
| Gate | `src-tauri/src/engine/commands.rs` `require_image_support` |
| Codex sync | `src-tauri/src/engine/codex_prompt_service.rs` |
| Features | `src-tauri/src/engine/mod.rs` + daemon `engine_bridge.rs` |
| FE capability | `src/features/engine/utils/engineImageInput.ts` |
| FE send | `src/features/threads/hooks/useThreadMessaging.ts` |
| FE text fidelity | `src/features/messages/presentation/messagesUserPresentation.ts` |
| FE image load | `MessageMediaBlocks` + `messageRowPresentation` + `LocalImage` |

---

## 四、各 Engine transport 细节

### Grok

- **有图**：`grok --prompt-file <staging.json> --output-format streaming-json ...`（ACP blocks 含 base64 image；argv 只传路径）
- **无图**：`grok -p "..."`（兼容旧行为）
- 非空 prompt 在 ACP `text` block 中原文保真，不做 `trim()` 改写
- 单图 soft-cap **2MiB**；整段 payload 写 `{workspace}/.mossx/image-staging/grok-prompt-*.json`，不受 argv 700KB 限制
- 历史：CLI 落盘为 `<image_files>…</image_files>` + `<user_query>…</user_query>`；加载时拆成正文 + `images[]`
- relative path 按 workspace 解析；data URL 在 decode 前执行 2MiB guard
- 预览白名单仅包含 `~/.grok/sessions` / `$GROK_HOME/sessions`

### Kimi

- headless **无** `--image` flag
- 注入格式：用户正文 + marker `<!-- mossx:kimi-image-attachments -->` + ReadMediaFile 指令 + `<image path="abs">`
- data URL 先落到 `{workspace}/.mossx/image-staging/`
- 历史 loader：按 marker（及 legacy 英文指令）strip，路径还原到 `images[]`
- **语义**：agent 工具读图，不是 ACP 首包 inline vision

### OpenCode

- `opencode run --format json -f <path> ... "message"`
- data URL 同样经 staging 落盘

### Codex sync

- `run_codex_prompt_sync(..., images)` → `params_to_codex_input` → `turn/start.input` 含 image items
- 与 async 路径语义对齐

---

## 五、幕布展示契约（已验收）

1. **发送侧**用户气泡只使用 `visibleUserText` + `images[]`，不含 CLI 私有注入。
2. **历史侧**必须 strip 引擎包装并填充 `images`：
   - Grok：`image_files` + `user_query`
   - Kimi：mossx marker / legacy ReadMediaFile 块
3. **渲染侧** `MessageImage` 带 `localPath`；`MessageImageGrid` 用 `LocalImage`：
   - 先 `convertFileSrc`
   - 失败则 `read_local_image_data_url(workspaceId, localPath)`
4. presentation 层不对任意用户文本做 marker/tag heuristic strip；避免误删用户原文。

---

## 六、已知边界

| 项 | 说明 |
|---|---|
| Kimi 读图 | 依赖模型调用 `ReadMediaFile`；模型无 `image_in` 时不可视 |
| Grok 大图 | 超单图 2MiB soft-cap 显式失败；整段 payload 经 `--prompt-file` 不受 argv 700KB 限制 |
| staging | 写在 `{workspace}/.mossx/image-staging/`；建议 gitignore |
| 远程模式 | `read_local_image_data_url` 不支持 remote |
| fail-fast 门禁 | 当前全引擎 supported，client/backend 门禁基本 no-op，保留给未来 unsupported engine |

---

## 七、验收（已通过）

- [x] Claude / Codex 贴图回归正常
- [x] Grok 小图可发，幕布显示原文 + 缩略图（非 `<image_files>` 字）
- [x] OpenCode `-f` 可发
- [x] Kimi 可发，幕布显示原文 + 缩略图（非 ReadMediaFile 字）

---

## 八、一句话

**matrix `image.input = supported` 已与各 CLI 可交付 transport + 幕布展示契约对齐；差异只在协议形态，不在「能不能贴图」。**
