//! Shared Event Storage（Wave 1 / A1，dark launch）。
//!
//! 本模块是 Shared Session V2 的 SQLite WAL Canonical Event Storage 地基：
//! - 六表 schema + `PRAGMA user_version` 单调 migration（[`schema`]）；
//! - `SharedEventWriter` 单写者 Actor（专用 OS 线程 + `std::sync::mpsc`），
//!   event insert 与 per-session `next_sequence` 分配在同一 SQLite transaction 提交；
//! - 三条幂等路径：`PRIMARY KEY (session_id, event_id)`、
//!   partial unique index `(session_id, attempt_id, fact_type)`（usage 例外）、
//!   partial unique index `(session_id, fact_type, dedupe_key)`；
//! - Provider Usage Ledger 独立归属，revision/supersede 链校验（[`ledger`]）；
//! - deterministic-json + SHA-256 payload checksum，由 writer 内部计算落盘；
//! - 启动恢复：read-only `PRAGMA quick_check(1)` 将错误输出限制为一条；hot WAL 的 typed
//!   `READONLY` 使用 no-create/query-only fallback，真实 integrity failure → read-only recovery，
//!   绝不删除/重命名/覆盖损坏文件（[`recovery`]）。
//!
//! 设计来源：`openspec/changes/establish-shared-event-storage/design.md` 与
//! Foundation Design §14.4。本模块不接 UI、不接 Runtime Adapter、不注册 Tauri command。

mod checksum;
mod error;
mod ledger;
mod recovery;
mod schema;
mod writer;

pub mod canonical;

pub use checksum::{deterministic_json_bytes, payload_checksum};
pub use error::StoreError;
pub use ledger::{LedgerOutcome, ProviderUsageRecord, StoredLedgerRow};
pub use recovery::{open, OpenOutcome, ReadOnlyEventReader, RecoveryReason};
#[doc(hidden)]
pub use writer::{open_crash_test_writer, TxBoundary};
pub use writer::{
    AppendOutcome, BindingStateUpdate, Fidelity, LegacyImportRow, MutationLeaseAction,
    MutationLeaseOutcome, MutationLeaseRequest, NewCanonicalEvent, ProjectionCheckpointRow,
    SessionTargetUpdate, SharedEventWriter, StoredBindingState, StoredEvent, StoredSessionTarget,
    USAGE_FACT_TYPE,
};
