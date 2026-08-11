# File History View Cross-Layer Contract

本规范固化单文件 Git history 从 FileTree 到 Desktop/daemon backend 的 executable contract，适用于 `src/features/files/**`、`src/features/git-history/**`、`src/services/tauri/git.ts`、`src-tauri/src/git/commands.rs`、`src-tauri/src/shared/git_core.rs` 与 `src-tauri/src/bin/doge_daemon*`。

## 1. Scope / Trigger

- Trigger：修改 FileTree/Git Diff 文件历史入口、`FileHistoryTarget`、`getGitCommitHistory` 的 `path`、snapshot identity、rename-follow、remote forwarding、File History layout 或 selected diff renderer。
- 目标：root/nested repository 都只查询目标文件，Desktop local 与 remote daemon 保持 payload/response parity。
- 禁止：frontend 遍历 commits 后逐个拉 diff 做 N+1 filtering；禁止把 file mode 塞入通用 `GitHistoryPanelImpl`。

## 2. Signatures

```ts
export type FileHistoryTarget = {
  workspaceId: string;
  workspacePath: string;
  repositoryRoot: string;
  path: string;
  displayPath: string;
};

export type GitHistoryCommit = {
  sha: string;
  // path-scoped history 中该 commit 实际使用的 repository-relative path
  filePath?: string | null;
};

getGitCommitHistory(workspaceId, {
  path?: string | null;
  repositoryRoot?: string | null;
  snapshotId?: string | null;
  offset?: number;
  limit?: number;
}): Promise<GitHistoryResponse>

getGitCommitDiff(workspaceId, sha, {
  path?: string | null;
  repositoryRoot?: string | null;
}): Promise<GitCommitDiff[]>

WorkspaceReadOnlyDiffCompare({
  filePath: string;
  diff: string;
  loadFullDiff?: ((path: string) => Promise<string>) | null;
  useFullDiff?: boolean;
  resizableColumns?: boolean;
}): JSX.Element

CompareEditorColumn({
  draft: CompareColumnDraft;
  markers: GitLineMarkers;
  lineGaps: FileCompareLineGap[];
  activeLineNumber: number | null;
  diffTone?: "deletion" | "addition" | null;
  lineNumberLabels?: readonly (number | null)[] | null;
}): JSX.Element
```

```rust
async fn get_git_commit_history(
    workspace_id: String,
    branch: Option<String>,
    query: Option<String>,
    author: Option<String>,
    date_from: Option<i64>,
    date_to: Option<i64>,
    snapshot_id: Option<String>,
    path: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
    repository_root: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<GitHistoryResponse, String>
```

Daemon method 使用同字段顺序与语义，其中 pagination 的 `offset/limit` 为解析后的 `usize`。RPC payload 使用 camelCase `workspaceId/snapshotId/repositoryRoot`，`path` 保持 repository-relative normalized path。

## 3. Contracts

- `path === undefined/null`：保持 repository-wide revwalk、filters、pagination 与 DTO，不执行 `git log --follow`。
- `path` present：先 normalize/validate，再以受控 argv 执行 `git log --follow --format=%H%x00 --name-only -z <ref> -- <path>`；只接受 40 位 hex OID，并将每个 OID 对应的 commit-time path 映射到 `GitHistoryCommit.filePath`。
- `repositoryRoot === ""` 是 explicit workspace-root identity，禁止 truthy fallback；nested root 选择 longest path match，传给 backend 的 `path` 必须剥离 root prefix。
- snapshot identity MUST 包含 HEAD、branch/query/author/date filters、`repositoryRoot` 与 normalized `path`；另一个 path 复用 snapshot 必须报 expired/mismatch。
- Desktop remote forwarding 与 daemon dispatch MUST 原样保留 optional `path` 和 `repositoryRoot`。
- `FileHistoryView` 首屏固定请求 100 条，只为 selected commit 请求 diff；history target 与 selected commit 分别使用 generation guard 拒绝 stale response。
- selected diff request MUST 使用 `selectedCommit.filePath ?? target.path`，并且 response 只能 exact-match 该 path；禁止以 `diffs[0]` 回退到无关文件。
- selected text diff MUST 复用 `WorkspaceReadOnlyDiffCompare`，输出“上个版本 / 源代码”aligned CodeMirror panes；unified patch 的 old/new hunk coordinates MUST 作为 gutter label 传入 CodeMirror，跨 hunk separator 使用空 label，禁止重置为 1。
- image entry MUST 保留 shared `GitDiffViewer` image rendering；Desktop local 与 remote daemon MUST 复用同一 image mapping，返回 old/new MIME 与 base64 payload。non-image binary MUST 显示 explicit binary state，不得伪装成 text diff 或 generic unavailable。File History 不得创建第二套 diff parser/renderer，也不得把历史内容变成 editable。
- normal read-only compare MUST use `editable=false` + `readOnlyReason=null`，因此仍进入 `FileCodeMirrorEditor`；`readOnlyReason/error/truncated` 才允许触发 `.file-compare-readonly-content` fallback。禁止把 read-only 与 plain-text renderer 绑定。
- previous column MUST pass `diffTone="deletion"`，source column MUST pass `diffTone="addition"`。Scoped CSS MUST 将 changed lines 分别渲染为 red/green，同时保留 shared markers、aligned gaps 与 syntax highlighting。
- difference navigation MUST work for read-only CodeMirror。`CompareEditorColumn` 只在 plain-text fallback 时跳过 programmatic selection/scroll，不得仅因 `editable=false` 跳过。
- `.file-history-view` MUST 是 named inline-size container。Workbench 宽屏使用 bounded commit rail + `minmax(0, 1fr)` diff；narrow threshold MUST 基于 container 而不是 viewport。
- File History scope MUST 将 `.editable-diff-compare-columns` 和 `.file-compare-column` 的 fixed minimum 收敛为 `minmax(0, 1fr)` / `min-width: 0`，让 compare 消费剩余宽度；long lines 由 CodeMirror pane 自己滚动。
- File History 下面面板 MUST 拆为 3 个区域：commit rail / previous column / source column；commit rail ↔ diff 之间与 previous ↔ source 之间 MUST 各渲染一个 8px 拖拽手柄，并支持双击复位到默认宽度/比例。拖拽过程中 MUST 使用 `window.mousemove/mouseup` 监听，且 reset on unmount/target change。
- splitter drag MUST 基于 `mousedown` 时的 width/ratio snapshot 计算，禁止把累计位移重复叠加到 current value；高频视觉更新 MUST 通过 ref + `requestAnimationFrame` 写 CSS custom property，避免每次 `mousemove` 触发 React render。
- File History 拖拽 commit rail 手柄时宽度 MUST clamp 到 [200px, 60% of container]；拖拽 previous ↔ source 手柄时 previous fr 占比 MUST clamp 到 [0.2, 0.8]。
- Git 中间区域 preview MUST 保留既有 toolbar controls；split text body MUST 复用 `WorkspaceReadOnlyDiffCompare` 的 aligned CodeMirror renderer。unified、image、binary 与 PR preview MUST 保留既有 specialized renderer。
- File History 的 compare 容器 MUST 不再以 `overflow: hidden` 截断超宽 compare 内容；超宽行 MUST 由 `.cm-scroller` 自身 `overflow: auto` 横向滚动呈现，columns container 宽度 MUST NOT 被内容撑宽。
- `loadFileHistoryStyles()` MUST 同时加载 diff、file-view compare 和 file-history styles。
- `FileTreePanel.onOpenFileHistory` MUST optional；callback 缺失、folder target、invalid/escaping path、没有 owning repository 时不显示入口。
- `GitDiffPanel.onOpenFileHistory` MUST optional；single/multi changed-file menu 只在 callback、workspace identity 与 valid repository-relative target 同时存在时显示 History。
- Git Diff History MUST capture the clicked row only；single bulk mutation selection MUST NOT alter `FileHistoryTarget.path`。
- Git Diff `mutationDisabled` / diff-only row MAY retain read-only History，但 MUST expose zero Stage/Unstage/Discard actions。
- Git Diff single root MUST normalize absent/empty/workspace-equal `gitRoot` to `repositoryRoot=""`；nested root MUST be workspace-relative；multi mode MUST preserve row-owned explicit root including `""`。

## 4. Validation & Error Matrix

| 输入/事件 | 必须行为 | Error/UI settle |
|---|---|---|
| omitted `path` | repository-wide history | existing callers 无回退 |
| `src/main.ts` + root repo | `repositoryRoot=""`, `path="src/main.ts"` | file-only commits |
| `packages/app/src/main.ts` + nested repos | longest root=`packages/app`, path=`src/main.ts` | child repository history |
| Windows separators | normalize `\\` 为 `/` | 与 POSIX path 等价 |
| absolute、drive prefix、empty、`.`、`..` | backend reject before Git query | explicit readable error |
| rename chain | Git `--follow` OID sequence | 包含 rename 前 commits |
| select pre-rename commit | request 使用该 commit 的 `filePath` | exact historical diff，不回退到 response 第一项 |
| file A request 后切 file B | A late response ignored | B commits/error/diff 不变 |
| commit A diff 后切 commit B | A late diff ignored | B diff/error 不变 |
| path/snapshot mismatch | reject pagination | UI 可 Retry 首屏 |
| remote mode | exact camelCase payload forwarded | daemon state is source of truth |
| wide host container | commit rail bounded，compare fills remainder | 不得留下空白列或让 diff width 跟内容走 |
| narrow host container | history rail stacks above full-width compare | 不得依赖 `100vw`/viewport media query |
| selected text diff | previous/source read-only panes + synchronized compare | 不得允许 edit 或复制 shared renderer |
| selected image diff | shared image-capable viewer | 不得把 image entry 送进 CodeMirror 空文本列 |
| selected non-image binary | explicit binary state | 不得显示 generic diff unavailable |
| multi-hunk historical text | gutter 保留 old/new hunk line numbers | separator 为空，后续 hunk 不得从 1 重新计数 |
| normal read-only text | CodeMirror + decorations + `editable=false` | 不得因 read-only reason 渲染 `<pre>` |
| previous/source change | red deletion / green addition | 不得两栏都显示 generic blue modified |
| difference navigation | read-only editor scrolls to active line | 不得把 programmatic navigation 当 mutation 禁用 |
| long source line | editor-local horizontal scroll | 不得撑宽 File History workspace |
| commit rail ↔ diff splitter drag | commit rail width 在 [200px, 60% container] 平滑变化，diff 区域随之收放 | mouseup 后释放监听、cursor 复位 |
| previous ↔ source splitter drag | previous column fr 在 [0.2, 0.8] 平滑变化 | clamp 后不允许 0 或 1 边界出现 |
| 任一 splitter double-click | 该区域 MUST 复位到默认 commit rail ~26% / previous 50% | 不得保留 stale width 跨 target 切换 |
| narrow container ≤720px | splitter 隐藏、stack 为 commit rail 上 / diff 下 | 不依赖 viewport media query |
| Git Diff single multi-selection | clicked row target only | selected paths 不得替换 History path |
| Git Diff multi A/B same path | clicked `repositoryRoot + path` | 不得 path-only 串仓 |
| Git Diff explicit root `""` | empty string preserved | 不得 fallback configured root |
| Git Diff mutation-disabled row | History-only when target valid | 不得暴露 mutation 或隐藏 read-only capability |
| Git Diff missing callback/workspace/valid scope | omit History item | 不得显示 dead entry |

## 5. Good / Base / Bad Cases

- Good：`packages/app/src/main.ts` → `{ repositoryRoot: "packages/app", path: "src/main.ts" }` → daemon `git log --follow` → selected commit scoped diff。
- Base：`getGitCommitHistory(workspaceId)` 继续发送 `path: null`，backend 使用原 revwalk。
- Bad：nested repository 仍发送 workspace-relative `packages/app/src/main.ts`，导致 child repo query empty。
- Bad：用 `if (repositoryRoot)` 判断 scope，吞掉合法 root identity `""`。
- Bad：history/diff promise resolve 后不核对 generation，旧文件或旧 commit 覆盖当前 UI。
- Good：File History container 变窄时，layout 自己切换上下结构，right panel 是否打开不影响 breakpoint truth。
- Good：historical text column 使用 `{ editable: false, readOnlyReason: null }`，因此 CodeMirror/markers 保留但 user mutation 被禁用。
- Good：rename 前 commit 暴露 `filePath="src/before.ts"`，diff request 与 exact-match 都使用该 historical path。
- Good：multi repository `services/api + pom.xml` → `{ repositoryRoot: "services/api", path: "pom.xml", displayPath: "services/api/pom.xml" }`。
- Good：single selected A/B，right-click B → History target B；Stage/Discard 仍可使用 A/B bulk target。
- Good：`@@ -56,2 +60,2 @@` 后接 `@@ -90 +94 @@` 时，两栏 gutter 分别延续为 `56,57,90` 与 `60,61,94`。
- Bad：用 `@media (max-width: ...)` 推断 center surface 宽度，导致 window 很宽但 center panel 很窄时仍保持左右挤压。
- Bad：为复刻 Diff UI 再写一套 previous/source reconstruction 或 CodeMirror columns。
- Bad：用 `readOnlyReason: t("files.readOnly")` 表示普通只读，意外触发 `<pre>` fallback 并丢失全部 decorations。
- Bad：selected response 未命中 path 时渲染 `diffs[0]`，可能把同一 commit 的另一个文件冒充目标文件。
- Bad：`mutationDisabled` early return 同时移除 History，混淆 write capability 与 read capability。
- Bad：multi same-path History 根据 flat path 反查 repository，导致打开另一仓文件。

## 6. Tests Required

- `src/services/tauri.test.ts`：assert omitted payload 为 `path:null`；scoped payload 同时包含 exact `path/repositoryRoot`。
- `fileGitScope.test.ts`：assert root、longest nested、Windows、escape、no-match。
- `FileTreePanel.run.test.tsx`：assert root/nested file submenu payload；callback omitted 时无 Git dead entry。
- `FileHistoryView.test.tsx`：用 deferred promises assert rapid file switch 与 commit switch 丢弃 late response。
- `FileHistoryView.test.tsx`：assert selected entry 的 exact `filePath/diff` 传给 shared aligned read-only compare。
- `FileHistoryView.test.tsx`：assert pre-rename commit 使用 historical `filePath`；unrelated first diff 不渲染；non-image binary 显示 explicit state。
- `WorkspaceReadOnlyDiffCompare.test.ts`：assert previous/source reconstruction、read-only columns、difference navigation 与 stale full-diff guard。
- `WorkspaceReadOnlyDiffCompare.test.ts`：assert multi-hunk old/new gutter labels 使用 patch coordinates，separator 为 `null`。
- `WorkspaceFileComparePanel.compare-editor.test.tsx`：assert normal read-only draft renders CodeMirror with `editable=false`、semantic tone/markers、navigation dispatch；explicit unsupported reason retains plain-text fallback。
- `file-history-layout.test.ts`：assert named container、bounded wide grid、narrow stacked rows、fluid two-pane column override、`.file-history-vertical-resizer` / `.file-history-compare-resizer` 选择器存在、`.file-history-compare-grid` 不再用 `overflow: hidden` 截断 compare 内容。
- `FileHistoryView.test.tsx`：assert splitter 渲染存在、mousedown→mousemove→mouseup 调整 commit rail width（clamp）、双击复位、内 splitter 调整 previous fr（clamp）。
- `file-history-layout.test.ts`：assert deletion/addition scoped selectors 与 red/green theme colors 存在。
- `useGitPanelController.test.tsx`：assert multi-tab open/deduplicate/activate/close，active close 按右邻、左邻、Git Graph 顺序 fallback；切换其他 center surface 不得清空 Git Graph session tabs。
- `GitDiffPanelFileContextMenu.test.ts`：assert History ordering、History-only 与 empty action set。
- `GitDiffPanel.test.tsx`：assert root/nested/Windows/invalid target mapping、single clicked-only bulk selection、multi same-path/empty-root、mutation-disabled History-only 与 stale callback close。
- `useLayoutNodes.client-ui-visibility.test.tsx`：assert existing `onOpenFileHistory` capability 透传到 Git Diff。
- Rust `git::tests`：真实 repository fixture assert root rename-follow 的 OID + commit-time path、invalid paths 与不同 path snapshot identity。
- Rust `git_utils::tests`：assert shared image mapper 同时输出 old/new MIME 与 base64 payload；daemon target 必须 compile。
- Gate：`npm run typecheck`、focused Vitest、`cargo test ... file_history --lib`、daemon target compile、`npm run check:runtime-contracts`、strict OpenSpec validation。

## 7. Wrong vs Correct

### Wrong

```ts
const repository = repositories.find((entry) => filePath.startsWith(entry.repositoryRoot));
await getGitCommitHistory(workspaceId, { path: filePath });
```

这会选到较短 parent root，并把 workspace-relative path 错传给 nested repository。

### Correct

```ts
const scope = resolveFileGitScope(filePath, repositories);
if (scope) {
  await getGitCommitHistory(workspaceId, scope);
}
```

resolver 统一 separator/escape validation，并用 longest repository-root match 生成 exact boundary payload。

### Wrong: viewport sizing + duplicated renderer

```tsx
<MyHistoricalDiff oldText={oldText} newText={newText} />
```

```css
@media (max-width: 760px) {
  .file-history-workbench { grid-template-columns: 190px 1fr; }
}
```

### Correct: container sizing + shared renderer

```tsx
<WorkspaceReadOnlyDiffCompare filePath={target.path} diff={selectedDiff.diff} />
```

```css
.file-history-view { container: file-history / inline-size; }
.file-history-workbench {
  grid-template-columns: clamp(240px, 26%, 360px) minmax(0, 1fr);
}
@container file-history (max-width: 720px) {
  .file-history-workbench { grid-template-columns: minmax(0, 1fr); }
}
```

### Wrong: read-only 触发 renderer fallback

```ts
const draft = {
  editable: false,
  readOnlyReason: t("files.readOnly"),
};
```

### Correct: mutation capability 与 renderer capability 分离

```tsx
const draft = {
  editable: false,
  readOnlyReason: null,
};

<CompareEditorColumn
  draft={draft}
  markers={markers}
  diffTone="deletion"
  activeLineNumber={activeLineNumber}
  lineNumberLabels={historicalLineNumbers}
/>
```

### Wrong: rename 后仍绑定当前 path

```ts
const selectedDiff = diffs.find((entry) => entry.path === target.path) ?? diffs[0];
```

### Correct: commit identity 绑定 historical path

```ts
const selectedFilePath = selectedCommit.filePath ?? target.path;
const selectedDiff = diffs.find((entry) => entry.path === selectedFilePath) ?? null;
```

## Scenario: Git Graph Multi-Tab File History Host

### 1. Scope / Trigger

- Trigger：修改 `useGitPanelController.handleOpenFileHistory`、`GitHistoryPanel` title tabs、AppShell File History routing 或 `FileHistoryView` host header。
- 目标：File History 只作为 Git Graph domain workspace 的 document tab；禁止恢复独立 `centerMode="fileHistory"`，也禁止把 history fetch/diff data logic 塞进 `GitHistoryPanelImpl`。

### 2. Signatures

```ts
export const GIT_GRAPH_TAB_ID = "git-graph";

export function getFileHistoryTabId(target: FileHistoryTarget): string;

type GitHistoryTabsState = {
  activeTabId: string;
  fileHistoryTabs: FileHistoryTarget[];
};

type GitHistoryPanelProps = {
  fileHistoryTabs?: readonly FileHistoryTarget[];
  activeTabId?: string;
  onActivateTab?: (tabId: string) => void;
  onCloseFileHistoryTab?: (tabId: string) => void;
  onCloseOtherFileHistoryTabs?: (tabId: string) => void;
  onCloseAllFileHistoryTabs?: () => void;
};
```

### 3. Contracts

- tab identity MUST 使用 `workspaceId + repositoryRoot + path`；`displayPath` 只用于 label，禁止 path-only 或 label-only identity。
- `Git Graph` MUST 是 pinned first tab，不暴露 close action。
- `handleOpenFileHistory(target)` MUST 原子执行 deduplicate + activate，并请求打开 `appMode="gitHistory"`；MUST NOT 改写 editor `centerMode` 或关闭 file compare session。
- 关闭 inactive file tab MUST 保持 active tab；关闭 active tab MUST 依次选择右邻、左邻、`GIT_GRAPH_TAB_ID`。
- `GitHistoryPanel` wrapper owns document tab/content composition；`GitHistoryPanelImpl` 只提供既有 toolbar/body 的 opaque slot host，继续负责 repository-wide Git Graph，`FileHistoryView` 继续独立负责 path-scoped query/diff。
- document tabs MUST 插入既有 `.git-history-toolbar`，与 project/repository/HEAD/branch/status/actions 共用一行；禁止在 toolbar 上方新增第二条 titlebar/tab row。
- pinned Git Graph tab MUST icon-only，并保留 `aria-label/title`；File History tab MUST 复用 shared `FileIcon/getFileName`，可见 label 只显示 basename，完整路径保留在 `aria-label/title`，close action MUST 清除继承 padding/line-height 并保持几何居中。
- File History tab context menu MUST 复用 `RendererContextMenu` 与 `files.closeCurrentTab/closeOtherTabs/closeAllTabs`；关闭其他 MUST 只保留并激活 invoked tab，全部关闭 MUST 清空 File History tabs 并回到 `GIT_GRAPH_TAB_ID`；Graph pinned tab 不暴露 close menu。
- active File History MUST 只 mount 一个 `FileHistoryView`，并用 `showHeader=false` 避免 title strip 与 standalone header 双重 close authority。
- tab strip MUST expose `tablist/tab/tabpanel` semantics；所有 tabs 与 file-specific close action MUST keyboard reachable and have accessible names。
- tab strip MUST use horizontal overflow inside the Git History title width；不得撑宽 dock 或裁掉 panel close action。

### 4. Validation & Error Matrix

| 输入/事件 | 必须行为 | 禁止行为 |
|---|---|---|
| 首次打开 file A | 打开 Git Graph + append/activate A tab | 切 `centerMode=fileHistory` |
| 再次打开 file A | 更新 label payload并聚焦已有 A | append duplicate |
| 不同 workspace/repository 的同 path | 分别保留 tabs | path-only collision |
| active A，右侧有 B，关闭 A | activate B | 无条件回 Git Graph |
| active last tab，左侧有 A | activate A | active id 指向已删除 tab |
| 关闭 inactive tab | active view 不变 | 意外切换 body |
| File History active | mount exact target view + embedded body | background mount 所有 file views |
| tabs 超出宽度 | title strip 内横向滚动 | dock width overflow |

### 5. Good / Base / Bad Cases

- Good：`workspace-a + "" + src/App.tsx` 与 `workspace-b + packages/web + src/App.tsx` 同时打开且 identity 不冲突。
- Good：File Tree、File View、Git Diff 都复用同一个 `handleOpenFileHistory(FileHistoryTarget)` owner。
- Base：没有 file tabs 时只显示 pinned Git Graph，现有 branch/commit/worktree behavior 不变。
- Bad：在 `GitHistoryPanelImpl` 中复制 `getGitCommitHistory/getGitCommitDiff` state，形成第二套 async owner。
- Bad：继续用 `fileHistoryTarget: FileHistoryTarget | null`，新文件覆盖旧文件并让 tab UI 伪多开。

### 6. Tests Required

- `useGitPanelController.test.tsx` MUST cover duplicate open、same-path cross-repository identity、inactive close、right/left/graph fallback 与 `onOpenGitHistoryRequest`。
- `useGitPanelController.test.tsx` MUST cover atomic close-others/close-all state transitions。
- `GitHistoryPanel.tabs.test.tsx` MUST assert pinned Graph tab、multiple file tabs、active body、close/context-menu callbacks、`tablist/tab/tabpanel` roles 与 embedded `showHeader=false`。
- `FileHistoryView.test.tsx` MUST retain stale history/diff、rename、text/image/binary/retry coverage after host migration。
- `git-history-tabs-layout.test.ts` MUST assert title tabs `min-width:0`、`overflow-x:auto`、tabpanel bounded height 与 focus-visible styling。
- `npm run check:app-shell:runtime-contract`、`npm run check:git-history:runtime-contract`、`npm run typecheck`、`npm run lint` MUST pass。

### 7. Wrong vs Correct

#### Wrong

```ts
setFileHistoryTarget(target);
setCenterMode("fileHistory");
```

这把 Git domain navigation 塞回 editor center surface，且只能保留一个 target。

#### Correct

```ts
const tabId = getFileHistoryTabId(target);
setGitHistoryTabsState((current) => {
  const existingIndex = current.fileHistoryTabs.findIndex(
    (entry) => getFileHistoryTabId(entry) === tabId,
  );
  return {
    activeTabId: tabId,
    fileHistoryTabs: existingIndex < 0
      ? [...current.fileHistoryTabs, target]
      : current.fileHistoryTabs.map((entry, index) =>
          index === existingIndex ? target : entry,
        ),
  };
});
onOpenGitHistoryRequest?.();
```

identity、atomic state 与 Git Graph open request 三项 contract 不得拆散。

## 8. Scenario: Repository-wide Git History Filter Stability

### 1. Scope / Trigger

- Trigger：修改 `GitHistoryCommitFilters` debounce/clear/scope restore、`useGitHistoryCommitFilters` request mapping、repository-wide history pagination、Date preset、branch `"all"` / `"*"`，或 Desktop/daemon revwalk 初始化。
- 目标：first-page request 建立 canonical filter payload；同一 snapshot 的 append/retry 精确复用；新 snapshot 重新锚定 Date range；Desktop 与 daemon 使用同一 branch-scope resolver。

### 2. Signatures

```ts
type GitHistoryRequestFilters = {
  branch: string;
  query: string | null;
  author: string | null;
  dateFrom: number | null;
  dateTo: number | null;
  repositoryRoot?: string;
};

createHistoryRequestFilters(): GitHistoryRequestFilters

GitHistoryCommitFilters({
  draftScopeKey,
  values,
  onFiltersChange,
  onClear,
}: GitHistoryCommitFiltersProps): JSX.Element
```

```rust
fn push_git_history_branch_scope(
    repo: &git2::Repository,
    revwalk: &mut git2::Revwalk<'_>,
    branch: Option<&str>,
) -> Result<(), String>
```

### 3. Contracts

- `loadHistory(false)` MUST 调用 `createHistoryRequestFilters()` 创建新 payload，并写入 `historyRequestFiltersRef`；Date resolver 在这里重新读取 clock。
- `loadHistory(true)` 与 snapshot-expired retry MUST 复用该 ref/local payload，禁止重新计算 `dateFrom/dateTo`。
- `"all"`（case-insensitive）与 `"*"` MUST 由 shared `push_git_history_branch_scope` 推入 `refs/heads/*` + `refs/remotes/*`；其他 branch 按 local ref、remote ref、revparse 顺序解析。
- Desktop `src-tauri/src/git/commands.rs` 与 daemon `src-tauri/src/bin/doge_daemon/git.rs` MUST 调用同一个 shared helper，禁止复制两套特殊值判断。
- Clear MUST 先同步清空 child query/author draft，再通知 parent；`draftScopeKey` MUST 同时参与 external value sync 与 debounce cleanup dependency。
- partial author filter 只在 email 命中且 display name 未命中时显示 email；长 email MUST bounded/ellipsis。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| new first page + unchanged `7d` | 使用当前 clock 重新生成 range | 复用上一个 snapshot 的旧 `dateTo` |
| append / snapshot retry | exact reuse first-page filters | append 时再次调用 `Date.now()` |
| branch=`all` / `*` | Desktop/daemon 遍历 local + remote refs | daemon 报 `Branch or ref not found: all` |
| unknown branch | stable `Branch or ref not found: <name>` | fallback 到 HEAD 隐藏错误 |
| Clear before 300ms | draft 立即清空且 timer cancelled | stale query 延迟回填 |
| workspace switch before 300ms | old scope timer cancelled | old workspace draft 应用到新 workspace |
| partial email match | display name 保留并显示 matching email | 只有输入含 `@` 才显示 email |

### 5. Good / Base / Bad Cases

- Good：first page at 10:00 creates `{ dateFrom, dateTo }`；append/retry exact reuse；manual refresh at 11:00 creates a new pair。
- Good：shared helper 的 `"all"` revwalk 同时包含 local HEAD 与 remote-only tracking commit。
- Base：omitted branch pushes HEAD；Date preset `all` maps to `dateFrom/dateTo = null`。
- Bad：hook `useMemo([datePreset])` 固定 range，导致 Today 跨午夜后刷新仍查询昨天边界。
- Bad：daemon 对 `"all"` 运行 `push_ref("refs/heads/all")`。
- Bad：Clear 只清 parent applied values，child pending timer 随后重新发布旧 draft。

### 6. Tests Required

- `GitHistoryCommitFilters.test.tsx`：fake timer assert Clear-before-settle 与 `draftScopeKey` switch 都不发布 stale filters；assert Date picker end alignment 与 input browser hints。
- `GitHistoryPanel.test.tsx`：fake clock assert unchanged Date preset 的两个 first-page request 重新锚定；append + snapshot retry exact reuse first payload；partial email visible。
- `shared::git_core::tests::all_branch_scope_traverses_local_and_remote_refs`：在 `--lib` 与 `--bin cc_gui_daemon` target 都必须通过，assert `"all"` 与 `"*"` 包含 local + remote-only OID。
- Gate：targeted ESLint/Vitest、`npm run typecheck`、Git History runtime/static-import contracts、Rust focused tests、strict OpenSpec validation。

### 7. Wrong vs Correct

#### Wrong

```ts
const dateRange = useMemo(
  () => resolveGitHistoryDateRange(datePreset),
  [datePreset],
);
await getGitCommitHistory(workspaceId, {
  ...filters,
  ...resolveGitHistoryDateRange(datePreset),
  snapshotId,
});
```

第一种让新 snapshot 永久复用旧 clock，第二种让 append 改变 snapshot identity。

#### Correct

```ts
const requestFilters = append
  ? historyRequestFiltersRef.current ?? createHistoryRequestFilters()
  : createHistoryRequestFilters();

if (!append) {
  historyRequestFiltersRef.current = requestFilters;
}
```

```rust
git_core::push_git_history_branch_scope(&repo, &mut revwalk, branch.as_deref())?;
```
