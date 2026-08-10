# Code Reuse Thinking Guide（复用思考指南）

## 为什么重要

`doge` feature 多、runtime contract 多，复制粘贴会导致行为漂移（behavior drift）。

## 写新代码前先搜索（Search First）

```bash
rg -n "<symbol-or-keyword>" src
rg --files src/features/<feature>
```

## 高复用热点（优先查找）

- `src/services/tauri.ts`（command mapping）
- `src/services/clientStorage.ts`（persistent store）
- `src/utils/workspacePaths.ts`（path normalize/resolve）
- `src/lib/utils.ts`（`cn` class merge）
- `src/features/files/utils/*`（file/code-intel navigation utils）

## 抽取规则（Extraction Rules）

- 相同逻辑出现 3+ 次：必须考虑提取。
- 先 feature-local 提取，再按复用范围升级 shared。
- helper 优先 pure function，减少副作用耦合。

## 常见反模式（Anti-Patterns）

- 多个 hook 重复做 snake_case/camelCase 转换。
- 多处重复 `unknown -> message` 错误处理逻辑。
- style 逻辑重复拷贝而非 class 组合。

## 提交前检查

- 是否查过现有 utility？
- 新增 helper 命名是否语义精确？
- 抽取后是否引入了不必要的跨 feature 耦合？
