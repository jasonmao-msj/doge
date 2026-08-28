# Design: leaf-owned Project Map disclosure regression

## 1. Failure shape

```text
ProjectMapPanel test
  -> mount graph + detail + query + activity + advisor + navigation
  -> select path endpoints
  -> assert one <details> disclosure
  -> Windows batched runner > 5s timeout
```

The assertion owner is `ProjectMapNavigationPanel`; the expensive parent is incidental.

## 2. Target test shape

```text
createProjectMapDatasetFixture()
  -> buildProjectMapShortestPath()
  -> explainProjectMapAssociationPath()
  -> render(ProjectMapNavigationPanel)
  -> collapsed -> click -> expanded + relation reason
```

## 3. Contracts

- Pure path/explanation semantics remain covered in `utils/navigation.test.ts`。
- Disclosure rendering/interaction is owned by `ProjectMapNavigationPanel.test.tsx`。
- Parent `ProjectMapPanel.test.tsx` retains cross-surface orchestration tests, but MUST NOT carry leaf-only disclosure assertions requiring no parent state orchestration。
- Timeout MUST remain the default 5s；禁止用 `it(..., 15_000)` 或 global timeout 掩盖 parent harness cost。

## 4. Validation matrix

| Case | Expected | Forbidden |
|---|---|---|
| explanation found | details initially closed | mount full graph only to inspect details |
| click summary | details opens | arbitrary sleep / waitFor timeout inflation |
| relation reason | reason visible inside details | duplicate path algorithm fixture |
| Windows batch load | focused case stays bounded | extend global Vitest timeout |

## 5. Risk

低产品风险：production code zero diff。主要风险是迁移测试时丢失 compute coverage；通过复用 real helpers + 保留 `navigation.test.ts` 消除。
