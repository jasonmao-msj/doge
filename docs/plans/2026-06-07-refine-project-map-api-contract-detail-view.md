# Refine Project Map API Contract Detail View Implementation Plan

> **Lifecycle**：Implemented / Historical Plan。Canonical change 已归档于 `openspec/changes/archive/2026-06-10-refine-project-map-api-contract-detail-view/`；当前 API explorer 以 `src/features/project-map/` 与 main specs 为准。
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the unreleased Project Map `接口 API` module into a Swagger-like three-pane API explorer with richer scanner-backed endpoint details.

**Architecture:** Keep `ApiContractGraph` as the stable cross-language artifact boundary. Extend scanner and normalizer fields as optional evidence-backed metadata, then consume them through frontend projection helpers so UI layout, endpoint rows, inspector sections, and Markdown/HTML/OpenAPI exports stay decoupled from language-specific extraction.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Vite, Vitest, OpenSpec.

---

## Context Snapshot

OpenSpec change: `openspec/changes/refine-project-map-api-contract-detail-view/`

Primary frontend files:

- `src/features/project-map/types.ts`
- `src/features/project-map/utils/relationshipDashboardModel.ts`
- `src/features/project-map/components/projectMapRelationshipApiModel.ts`
- `src/features/project-map/components/ProjectMapRelationshipWorkspaces.tsx`
- `src/features/project-map/components/ProjectMapRelationshipSection.tsx`
- `src/features/project-map/components/ProjectMapRelationshipSection.api-smoke.test.tsx`
- `src/styles/**` Project Map relationship/API styles
- `src/i18n/locales/**`

Primary backend files:

- `src-tauri/src/project_map_api_contracts.rs`
- `src-tauri/src/project_map_api_contracts_tests.rs`

Do not introduce a Swagger UI dependency in the first implementation. The product needs Swagger-like presentation over a custom multi-language contract graph, not a full OpenAPI renderer.

## Implementation Rules

- Preserve old API artifacts. Every new scanner field must be optional in frontend normalizers.
- Do not fabricate descriptions, request bodies, responses, or method chains.
- Keep language-specific extraction inside Rust scanner adapters. Frontend must render only the shared contract model.
- Avoid adding new dependencies unless a mature parser is explicitly chosen and justified separately.
- Keep endpoint row paths single-line with truncation.
- Remove bottom `Repair / Read issues` strip from the API reading surface.
- Generate Markdown, HTML, and OpenAPI exports from the normalized graph/projection, not from DOM scraping.
- First export scope is full current workspace API contract graph. Do not silently export only selected group or current filter result.
- First OpenAPI format is OpenAPI 3.0 JSON only. Do not add YAML in this pass.
- Use fixed filenames: `api-contracts.md`, `api-contracts.html`, `api-contracts.openapi.json`.
- Escape HTML export text and keep exported evidence redacted.

## Task 1: Extend API contract types

**Files:**

- Modify: `src/features/project-map/types.ts`
- Modify: `src-tauri/src/project_map_api_contracts.rs`

**Step 1: Add optional frontend types**

Add description-source and structured-schema concepts near existing `ProjectMapApiEndpoint` types.

Suggested shape:

```ts
export type ProjectMapApiDescriptionSourceKind =
  | "doc-comment"
  | "swagger-annotation"
  | "schema-description"
  | "route-name"
  | "fallback";

export type ProjectMapApiDescriptionSource = {
  kind: ProjectMapApiDescriptionSourceKind;
  text: string;
  language?: string;
  evidence: ProjectMapApiEvidence[];
};

export type ProjectMapApiStructuredSchemaField = {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
  children?: ProjectMapApiStructuredSchemaField[];
  evidence?: ProjectMapApiEvidence[];
};
```

**Step 2: Attach optional fields to endpoint/body/response types**

Add optional fields such as `descriptionSources?: ProjectMapApiDescriptionSource[]` and `structuredFields?: ProjectMapApiStructuredSchemaField[]` to relevant API types.

**Step 3: Mirror serializable Rust structs**

Add `#[serde(rename_all = "camelCase")]` structs and optional fields in `project_map_api_contracts.rs`. Keep defaults compatible with omitted fields.

**Verification:**

Run later with `npm run typecheck` and `cargo test --manifest-path src-tauri/Cargo.toml project_map_api_contracts`.

## Task 2: Update frontend normalizers

**Files:**

- Modify: `src/features/project-map/utils/relationshipDashboardModel.ts`
- Test: `src/features/project-map/components/ProjectMapRelationshipSection.api-smoke.test.tsx` or existing model tests if present

**Step 1: Add local normalizers**

Create small pure functions:

```ts
function normalizeProjectMapApiDescriptionSources(value: unknown): ProjectMapApiDescriptionSource[] {
  // accept only objects with non-empty text and known kind fallback
}

function normalizeProjectMapApiStructuredSchemaFields(value: unknown): ProjectMapApiStructuredSchemaField[] {
  // recursively sanitize name/type/required/description/children
}
```

**Step 2: Thread fields through endpoint/request/response normalization**

Read new optional fields, but fallback to existing `description`, `usageScenario`, `schema.name`, and current parameter/response fields.

**Step 3: Add fixture coverage**

Extend the large API smoke fixture with at least one endpoint that contains Chinese doc comment, Swagger annotation description, query parameter, request body field, and response field.

**Verification:**

Run later: `npm run test -- src/features/project-map/components/ProjectMapRelationshipSection.api-smoke.test.tsx`.

## Task 3: Build API presentation projections

**Files:**

- Modify: `src/features/project-map/components/projectMapRelationshipApiModel.ts`

**Step 1: Add endpoint row projection**

Create helper:

```ts
export function buildProjectMapApiEndpointRow(endpoint: ProjectMapApiEndpoint): ProjectMapApiEndpointRow {
  return {
    id: endpoint.id,
    methodLabel: endpoint.method ?? endpoint.protocol.toUpperCase(),
    pathLabel: endpoint.path ?? endpoint.operationName ?? endpoint.handlerSymbol ?? endpoint.sourceFile,
    handlerLabel: endpoint.handlerSymbol ?? endpoint.operationName ?? null,
    summary: selectBestEndpointDescription(endpoint),
  };
}
```

**Step 2: Add detail section projection**

Create section helpers for overview, descriptions, parameters, request body, responses, evidence, and unavailable states.

**Step 3: Keep helpers pure**

No React imports in this file. This keeps it testable and prevents TSX growth.

**Verification:**

Covered by API smoke fixture and typecheck.

## Task 4: Refactor three-pane API layout

**Files:**

- Modify: `src/features/project-map/components/ProjectMapRelationshipWorkspaces.tsx`
- Modify: `src/styles/**` Project Map relationship styles

**Step 1: Identify API workspace JSX**

Replace current API stage structure with:

```tsx
<div className="project-map-api-workspace" style={paneTemplateStyle}>
  <aside className="project-map-api-pane project-map-api-pane-left">...</aside>
  <div className="project-map-api-resizer" role="separator" ... />
  <section className="project-map-api-pane project-map-api-pane-center">...</section>
  <div className="project-map-api-resizer" role="separator" ... />
  <aside className="project-map-api-pane project-map-api-pane-right">...</aside>
</div>
```

**Step 2: Implement pointer drag state**

Use local state for pane widths. Clamp all panes to usable minimums. Do not persist to client store in this first pass.

**Step 3: Preserve existing group selection props**

Do not change parent data flow unless necessary. Keep `selectedApiGroup`, `selectedApiEndpoint`, `apiEndpointSections`, and filter props stable.

**Verification:**

API smoke test should still render hierarchy and selected endpoint detail.

## Task 5: Replace endpoint card grid with endpoint rows

**Files:**

- Modify: `src/features/project-map/components/ProjectMapRelationshipWorkspaces.tsx`
- Modify: `src/styles/**`
- Test: `src/features/project-map/components/ProjectMapRelationshipSection.api-smoke.test.tsx`

**Step 1: Render one row per endpoint**

Map endpoint sections into row groups, but each endpoint must be a full-width button/list item.

**Step 2: Remove bottom tag rendering**

Delete the protocol/language/framework/confidence tag row from endpoint cards. Those facts belong in inspector overview or filters.

**Step 3: Add single-line path CSS**

Use `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` for path labels.

**Verification:**

Test should assert endpoint row text appears and old tag list is absent from center rows.

## Task 6: Build Swagger-like inspector sections

**Files:**

- Modify: `src/features/project-map/components/ProjectMapRelationshipWorkspaces.tsx`
- Optionally create: `src/features/project-map/components/ProjectMapApiEndpointDetail.tsx`
- Modify: `src/styles/**`
- Modify: `src/i18n/locales/**`

**Step 1: Prefer extracting a component**

If `ProjectMapRelationshipWorkspaces.tsx` is already large, create `ProjectMapApiEndpointDetail.tsx` for right pane detail.

**Step 2: Render sections**

Sections should include:

- Overview: method, path, handler, source, language, framework, confidence
- Description: code comment and Swagger/schema annotation descriptions
- Parameters: grouped path/query/header/cookie
- Request body: content type, schema tree, examples
- Responses: status, content type, schema tree, examples, error marker
- Evidence: source file, line, parser source, excerpt

**Step 3: Render unavailable states explicitly**

Use concise copy such as `暂未发现请求体结构` / `Response schema unavailable` through i18n.

**Verification:**

Smoke fixture should assert section headings and representative values.

## Task 7: Extend scanner extraction

**Files:**

- Modify: `src-tauri/src/project_map_api_contracts.rs`
- Modify: `src-tauri/src/project_map_api_contracts_tests.rs`

**Step 1: Preserve OpenAPI descriptions**

When parsing OpenAPI/Swagger operations, map `summary` and `description` into description sources with schema evidence.

**Step 2: Extract Java doc comments and annotations**

For current fallback Java/Spring extraction, scan nearby comments and common annotation text only when directly attached to the controller method. Keep confidence honest.

**Step 3: Emit structured request/response fields**

For OpenAPI, this should come from schema traversal. For fallback language adapters, emit schema refs or unavailable metadata only when evidence exists.

**Step 4: Add tests**

Add fixtures in existing Rust tests for:

- Chinese Java doc comment + Swagger annotation
- OpenAPI request body and response schema
- unavailable response body does not fabricate fields

**Verification:**

Run later: `cargo test --manifest-path src-tauri/Cargo.toml project_map_api_contracts`.

## Task 8: Remove bottom issue strip

**Files:**

- Modify: `src/features/project-map/components/ProjectMapRelationshipSection.tsx`
- Modify: `src/features/project-map/components/ProjectMapRelationshipWorkspaces.tsx`
- Modify: `src/styles/**`

**Step 1: Find the bottom issue rendering branch**

Remove it only for API tab if other relationship tabs still need it. If the strip is global and only useful nowhere, remove globally after checking usage.

**Step 2: Re-home meaningful status**

Keep scan count/stale/repair hints in top summary or inspector. Do not leave users without failure context.

**Verification:**

API smoke should not find `Repair / Read issues` in API tab main surface.

## Task 9: Add Swagger-like API export

**Files:**

- Create: `src/features/project-map/utils/apiContractExport.ts`
- Modify: `src/features/project-map/components/ProjectMapRelationshipWorkspaces.tsx`
- Modify: `src/features/project-map/components/ProjectMapRelationshipSection.api-smoke.test.tsx`
- Modify: `src/i18n/locales/**`

**Step 1: Build export projection**

Create a format-agnostic export document from the full current workspace `ProjectMapApiContractGraph`.

Suggested shape:

```ts
export type ProjectMapApiExportDocument = {
  title: string;
  generatedAt: string;
  endpoints: ProjectMapApiExportEndpoint[];
};
```

Each export endpoint should include method, path, operation/handler, descriptions, parameters, request body, responses, schemas, confidence, and redacted evidence.

**Step 2: Render Markdown**

Generate a Swagger-like Markdown document:

```markdown
# API Documentation

## GET /users/{id}

### Description

### Parameters

### Request Body

### Responses

### Evidence
```

Missing fields must render as unavailable, not guessed.

**Step 3: Render HTML**

Generate standalone HTML with escaped text. Do not inject raw comments, examples, or evidence excerpts into HTML. Add a fixture containing `<script>alert(1)</script>` and `onerror=` and assert raw executable markup is not preserved.

**Step 4: Render OpenAPI**

Generate an OpenAPI 3.0 JSON object. Standard fields should use `paths`, `parameters`, `requestBody`, and `responses`. Product-specific metadata should use extension fields such as `x-mossx-confidence`, `x-mossx-evidence`, and `x-mossx-unavailable`. Do not generate YAML in this pass.

**Step 5: Add UI format choice**

Add an API tab export control with `Markdown`, `HTML`, and `OpenAPI JSON` options. First pass uses downloads only:

- `api-contracts.md`
- `api-contracts.html`
- `api-contracts.openapi.json`

Copy-to-clipboard can be added later.

**Verification:**

Add focused assertions that all three formats include endpoint description, parameters, request body, responses, confidence/evidence metadata, and do not fabricate missing schemas.

## Task 10: Final validation

**Files:**

- No new implementation files unless Task 6 extracts detail component.

**Step 1: OpenSpec validation**

Run:

```bash
openspec validate refine-project-map-api-contract-detail-view --strict --no-interactive
```

Expected: pass.

**Step 2: TypeScript validation**

Run:

```bash
npm run typecheck
```

Expected: pass.

**Step 3: Focused frontend test**

Run:

```bash
npm run test -- src/features/project-map/components/ProjectMapRelationshipSection.api-smoke.test.tsx
```

Expected: pass.

**Step 4: Focused Rust scanner test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml project_map_api_contracts
```

Expected: pass.

**Step 5: CSS guard when style files grow**

Run if Project Map CSS is significantly touched:

```bash
npm run check:large-files
```

Expected: pass.

## 2026-06-07 Detail Contract Calibration

本次校准明确：详情页的主语义是接口方法签名，而不是 HTTP 表单拆块。`@RequestBody DTO param` 属于接口入参，展示时必须作为 `location=body` 的参数进入“接口入参” section；`Request body` 只保留 content-type、schema 等调用元信息，不再作为替代入参的独立一级模块。

必要展示项：

- 接口概述：接口名称、方法名、中文注释、功能描述、适用场景、版本信息。
- 接口调用方式：HTTP method、URL、Content-Type、Header、请求示例。
- 接口入参：方法所有参数，包含 path/query/header/cookie/body；对象入参必须展开 DTO/schema 字段，例如 `realNameCheckParam.vin`。
- 接口返回值：原始返回类型、业务返回类型、状态码、返回字段结构和描述。
- 错误码及处理：从 `@ApiResponses/@ApiResponse` 等证据中提取状态码和描述，缺失时明确 unavailable，不编造。

Scanner contract 同步调整：Java/Spring 中 `@RequestBody RealNameCheckParam realNameCheckParam` 必须同时产出 body input parameter 和 request body metadata；DTO class 字段、`@Schema/@ApiModelProperty`、Javadoc field comment、validation annotations 作为结构化字段证据进入参数树。
