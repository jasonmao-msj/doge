/**
 * Shared Projection 前端类型（Wave 3 / A3）。
 *
 * 与 Rust `src-tauri/src/shared_projection/types.rs`  serde 输出对齐；
 * 字段命名保持 camelCase（Rust `rename_all = "camelCase"`）。
 */

/** 事件保真度：canonical = 来自 Canonical Fact；presentation-only = Legacy/shadow 读取。 */
export type SharedProjectionFidelity = "canonical" | "presentation-only";

/** 投影项类型，覆盖 ConversationItem 的主要 kind，另含系统通知与元数据。 */
export type SharedProjectionItemKind =
  | "message"
  | "reasoning"
  | "tool"
  | "diff"
  | "review"
  | "explore"
  | "generatedImage"
  | "systemNotice"
  | "metadata";

/** 单个投影项；`content` 为 kind 相关的原始载荷（保留完整字段，Renderer 只读常用字段）。 */
export type SharedProjectionItem = {
  id: string;
  kind: SharedProjectionItemKind;
  content: Record<string, unknown>;
  fidelity: SharedProjectionFidelity;
  checksum: string;
};

/** 投影 checkpoint（与 `shared_projection_checkpoint` 表行对齐）。 */
export type SharedProjectionCheckpoint = {
  sessionId: string;
  projectionName: string;
  projectionVersion: number;
  throughSequence: number;
  payloadJson: string;
};

/** Shadow 对比 mismatch 分类。 */
export type SharedProjectionMismatchKind = "shadowOnly" | "legacyOnly" | "contentMismatch";

export type SharedProjectionMismatchRecord = {
  kind: SharedProjectionMismatchKind;
  itemId: string;
  detail: string;
};

export type SharedProjectionMismatchReport = {
  totalShadow: number;
  totalLegacy: number;
  matched: number;
  mismatches: SharedProjectionMismatchRecord[];
};
