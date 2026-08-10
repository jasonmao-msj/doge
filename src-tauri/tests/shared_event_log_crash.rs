//! 崩溃/掉电测试台（Wave 1 / A1.5，spec「Storage MUST Survive Kills」）。
//!
//! 模型（design.md §5 / D4）：
//! - 同一 test binary 以 `MOSSX_STORE_VICTIM=1` 重入为 victim 子进程，走真实
//!   `SharedEventWriter` 写路径，不模拟 WAL 行为；
//! - 边界强杀：victim 在四个事务边界（sequence 更新前 / sequence 更新后 insert 前 /
//!   COMMIT 前 / COMMIT 返回后）各打印一次 `ready:<boundary>` 信号后停住，父进程读到
//!   信号即 SIGKILL；
//! - 随机强杀：victim 持续写入并逐条汇报 `committed:<event_id>`，父进程在随机延迟后
//!   SIGKILL，共 50 轮；
//! - 重启断言：all-or-nothing（无半提交行）、sequence 单调无重复、`quick_check` 通过、
//!   已确认事件重放返回 `Duplicate`。
//!
//! 跨平台：`std::process::Child::kill` 在 Unix 即 SIGKILL、Windows 即 TerminateProcess，
//! 无需 libc 依赖。

mod common;

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::TempStoreDir;
use doge_lib::shared_event_log::{
    open, open_crash_test_writer, AppendOutcome, Fidelity, NewCanonicalEvent, OpenOutcome,
    SharedEventWriter, TxBoundary,
};

const VICTIM_FLAG_ENV: &str = "MOSSX_STORE_VICTIM";
const VICTIM_DB_ENV: &str = "MOSSX_STORE_VICTIM_DB";
const VICTIM_MODE_ENV: &str = "MOSSX_STORE_VICTIM_MODE";
const SESSION: &str = "crash-session";
const RANDOM_KILL_ROUNDS: usize = 50;
const VICTIM_SIGNAL_TIMEOUT: Duration = Duration::from_secs(30);

fn is_victim() -> bool {
    std::env::var(VICTIM_FLAG_ENV).is_ok()
}

fn make_victim_event(event_id: &str) -> NewCanonicalEvent {
    NewCanonicalEvent {
        session_id: SESSION.to_string(),
        event_id: event_id.to_string(),
        fact_type: "turn.userMessage".to_string(),
        logical_turn_id: None,
        attempt_id: None,
        dedupe_key: None,
        payload_json: format!("{{\"text\":\"{event_id}\"}}"),
        fidelity: Fidelity::Canonical,
        committed_at: 1_700_000_000_000,
        schema_version: 1,
    }
}

// ---------------------------------------------------------------------------
// victim 角色
// ---------------------------------------------------------------------------

/// victim 重入入口。父进程以 `--exact victim_entry` 过滤，只运行本测试。
#[test]
fn victim_entry() {
    if !is_victim() {
        return;
    }
    let db_path = std::env::var(VICTIM_DB_ENV).expect("victim db path env");
    let mode = std::env::var(VICTIM_MODE_ENV).expect("victim mode env");
    if let Some(boundary) = mode.strip_prefix("boundary:") {
        run_boundary_victim(&db_path, parse_boundary(boundary));
    } else if mode == "loop" {
        run_loop_victim(&db_path);
    } else {
        panic!("unknown victim mode {mode}");
    }
    std::process::exit(0);
}

fn parse_boundary(value: &str) -> TxBoundary {
    match value {
        "before-sequence-bump" => TxBoundary::BeforeSequenceBump,
        "after-sequence-bump" => TxBoundary::AfterSequenceBump,
        "before-commit" => TxBoundary::BeforeCommit,
        "after-commit" => TxBoundary::AfterCommit,
        other => panic!("unknown tx boundary {other}"),
    }
}

/// 边界 victim：命中目标边界时打印 ready 信号并永久停住，等待父进程 SIGKILL。
fn run_boundary_victim(db_path: &str, target: TxBoundary) {
    let writer = open_crash_test_writer(
        db_path.as_ref(),
        Box::new(move |hit| {
            if hit == target {
                println!("ready:{}", hit.as_str());
                let _ = std::io::stdout().flush();
                loop {
                    std::thread::sleep(Duration::from_secs(3600));
                }
            }
        }),
    )
    .expect("open crash-test writer");
    // 命中边界后永不返回；未命中说明 hook 安装错误。
    let _ = writer.append_event(&make_victim_event("evt-boundary"));
    eprintln!("boundary victim escaped hook for {}", target.as_str());
    std::process::exit(2);
}

/// 循环 victim：逐条 append，每条 commit 返回后立即汇报 committed。
fn run_loop_victim(db_path: &str) {
    let store = open_store_with_retry(db_path);
    for index in 0..i64::MAX {
        let event_id = format!("evt-{index}");
        match store.append_event(&make_victim_event(&event_id)) {
            Ok(AppendOutcome::Inserted { .. }) => {
                println!("committed:{event_id}");
                let _ = std::io::stdout().flush();
            }
            other => {
                eprintln!("loop victim unexpected outcome at {event_id}: {other:?}");
                std::process::exit(2);
            }
        }
    }
}

/// 刚被 spawn 的 victim 偶发遭遇瞬时 SQLITE_CANTOPEN（macOS 上新建目录的首次
/// sqlite create 与进程启动竞态相关）；测试台做有限次退避重试并留痕，
/// 产品代码不受影响（应用进程内打开，不经此路径）。
fn open_store_with_retry(db_path: &str) -> SharedEventWriter {
    const MAX_ATTEMPTS: u32 = 10;
    for attempt in 1..=MAX_ATTEMPTS {
        match open(db_path.as_ref()) {
            Ok(OpenOutcome::Ready(writer)) => return writer,
            Ok(OpenOutcome::ReadOnlyRecovery { reason, .. }) => {
                panic!("victim db unexpectedly entered recovery: {reason}")
            }
            Err(error) => {
                eprintln!("victim open attempt {attempt}/{MAX_ATTEMPTS} failed: {error}");
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    panic!("victim open store failed after {MAX_ATTEMPTS} attempts");
}

// ---------------------------------------------------------------------------
// 父进程工具
// ---------------------------------------------------------------------------

fn spawn_victim(db_path: &std::path::Path, mode: &str) -> Child {
    let mut command = Command::new(std::env::current_exe().expect("current test binary"));
    command
        .args(["victim_entry", "--exact", "--nocapture", "--test-threads=1"])
        .env(VICTIM_FLAG_ENV, "1")
        .env(VICTIM_DB_ENV, db_path)
        .env(VICTIM_MODE_ENV, mode)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit()) // 临时调试：暴露 victim 死亡原因
        .spawn()
        .expect("spawn victim process")
}

/// 带超时读取 victim 的 ready 信号（跳过 libtest 的 "running 1 test" 等前导行），
/// 避免 victim 异常时测试永久挂起。
fn read_ready_signal(child: &mut Child) -> String {
    let stdout = child.stdout.take().expect("victim piped stdout");
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            // libtest 会把 "test victim_entry ... " 前缀与 victim 的首行输出粘在同一行，
            // 因此判断 contains 而非 starts_with。
            if line.contains("ready:") {
                let _ = sender.send(line);
                break;
            }
        }
    });
    receiver
        .recv_timeout(VICTIM_SIGNAL_TIMEOUT)
        .expect("victim signal timeout")
}

/// 确定性伪随机（xorshift64）：避免引入 rand 依赖。
fn next_random(state: &mut u64) -> u64 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    x
}

fn random_seed() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0x9e3779b97f4a7c15)
        | 1
}

// ---------------------------------------------------------------------------
// Scenario: kill at transaction boundaries
// ---------------------------------------------------------------------------

#[test]
fn kill_at_each_transaction_boundary_is_all_or_nothing() {
    if is_victim() {
        return;
    }
    for boundary in [
        TxBoundary::BeforeSequenceBump,
        TxBoundary::AfterSequenceBump,
        TxBoundary::BeforeCommit,
        TxBoundary::AfterCommit,
    ] {
        let temp = TempStoreDir::new(&format!("boundary-{}", boundary.as_str()));
        let mut child = spawn_victim(&temp.db_path, &format!("boundary:{}", boundary.as_str()));
        let signal = read_ready_signal(&mut child);
        assert!(
            signal.contains(&format!("ready:{}", boundary.as_str())),
            "victim must signal the requested boundary, got: {signal:?}"
        );
        child.kill().expect("sigkill victim");
        child.wait().expect("reap victim");

        let store = open_store_with_retry(temp.db_path.to_str().expect("utf8 db path"));
        assert_eq!(
            store.quick_check().expect("quick_check"),
            "ok",
            "quick_check must pass after kill at {}",
            boundary.as_str()
        );
        let events = store
            .events_for_session(SESSION)
            .expect("events after kill");

        match boundary {
            TxBoundary::AfterCommit => {
                // COMMIT 已返回：事件必须完整落盘，重放命中幂等。
                assert_eq!(events.len(), 1, "committed tx must survive kill");
                assert_eq!(events[0].sequence, 1);
                assert_eq!(events[0].event_id, "evt-boundary");
                assert_eq!(
                    store
                        .append_event(&make_victim_event("evt-boundary"))
                        .expect("replay after kill"),
                    AppendOutcome::Duplicate {
                        existing_sequence: 1
                    },
                    "acknowledged event must dedupe after restart"
                );
            }
            _ => {
                // COMMIT 前被杀死：事务整体回滚，无半提交行、无 sequence 泄漏。
                assert!(
                    events.is_empty(),
                    "kill at {} must roll back the whole transaction",
                    boundary.as_str()
                );
                assert_eq!(
                    store.next_sequence(SESSION).expect("next_sequence"),
                    None,
                    "session row must not leak from rolled-back transaction"
                );
                assert!(
                    matches!(
                        store
                            .append_event(&make_victim_event("evt-boundary"))
                            .expect("rewrite after kill"),
                        AppendOutcome::Inserted { sequence: 1, .. }
                    ),
                    "rewrite after rollback must allocate sequence 1"
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Scenario: random kills never corrupt（≥50 轮）
// ---------------------------------------------------------------------------

#[test]
fn random_kills_never_corrupt_across_50_rounds() {
    if is_victim() {
        return;
    }
    let mut seed = random_seed();
    let mut total_persisted = 0_usize;
    for round in 0..RANDOM_KILL_ROUNDS {
        let temp = TempStoreDir::new(&format!("random-{round}"));
        let mut child = spawn_victim(&temp.db_path, "loop");

        // 收集 victim 汇报的已确认事件，直到 SIGKILL 后 stdout EOF。
        let stdout = child.stdout.take().expect("victim piped stdout");
        let (sender, receiver) = mpsc::channel::<String>();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if sender.send(line).is_err() {
                    break;
                }
            }
        });

        let delay_millis = next_random(&mut seed) % 60 + 1;
        std::thread::sleep(Duration::from_millis(delay_millis));
        child.kill().expect("sigkill victim");
        child.wait().expect("reap victim");
        reader.join().expect("join victim stdout reader");

        let mut reported = Vec::new();
        while let Ok(line) = receiver.try_recv() {
            // libtest 前导（"test victim_entry ... "）可能与首条汇报粘在同一行，
            // 因此用 find 定位 marker 而非 strip_prefix。
            if let Some(pos) = line.find("committed:") {
                reported.push(line[pos + "committed:".len()..].to_string());
            }
        }

        let store = open_store_with_retry(temp.db_path.to_str().expect("utf8 db path"));
        assert_eq!(
            store.quick_check().expect("quick_check"),
            "ok",
            "round {round}: quick_check must pass"
        );
        let events = store
            .events_for_session(SESSION)
            .expect("events after random kill");
        total_persisted += events.len();

        // victim 顺序写入 evt-0..，汇报也是顺序的：两边都必须是同前缀。
        for (index, event_id) in reported.iter().enumerate() {
            assert_eq!(
                event_id,
                &format!("evt-{index}"),
                "round {round}: victim reports must be an ordered prefix"
            );
        }
        // DB 落盘集合 == 已汇报集合（+至多一条 commit 后未及汇报的尾巴）。
        assert!(
            events.len() == reported.len() || events.len() == reported.len() + 1,
            "round {round}: {} committed reports vs {} persisted events",
            reported.len(),
            events.len()
        );
        for (index, event) in events.iter().enumerate() {
            assert_eq!(
                event.event_id,
                format!("evt-{index}"),
                "round {round}: persisted events must be a strict prefix (no partial tx)"
            );
            assert_eq!(
                event.sequence,
                index as i64 + 1,
                "round {round}: sequence must be monotonic without duplicates"
            );
        }

        // 重启后重放最后一条已确认事件 → Duplicate（重启幂等）。
        if let Some(last) = reported.last() {
            let outcome = store
                .append_event(&make_victim_event(last))
                .expect("replay acknowledged event after restart");
            assert!(
                matches!(outcome, AppendOutcome::Duplicate { .. }),
                "round {round}: acknowledged event {last} must dedupe after restart"
            );
        }
    }

    // 防静默退化：若 victim 普遍在首次 commit 前被杀，上述断言会全部空洞通过。
    // 要求 50 轮累计落盘事件达到最低量级，证明压测真实发生。
    assert!(
        total_persisted >= RANDOM_KILL_ROUNDS * 5,
        "crash bench degraded: only {total_persisted} events persisted across {RANDOM_KILL_ROUNDS} rounds"
    );
    eprintln!(
        "crash bench: {total_persisted} events persisted across {RANDOM_KILL_ROUNDS} random kills"
    );
}
