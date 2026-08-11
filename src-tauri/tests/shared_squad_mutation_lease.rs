mod common;

use common::TempStoreDir;
use doge_lib::shared_event_log::{
    open, MutationLeaseAction, MutationLeaseOutcome, MutationLeaseRequest, OpenOutcome,
    SharedEventWriter,
};

fn writer(store: &TempStoreDir) -> SharedEventWriter {
    match open(&store.db_path).expect("open store") {
        OpenOutcome::Ready(writer) => writer,
        OpenOutcome::ReadOnlyRecovery { reason, .. } => panic!("unexpected recovery: {reason}"),
    }
}

fn request(
    workspace_id: &str,
    run_id: &str,
    attempt_id: &str,
    action: MutationLeaseAction,
    occurred_at: i64,
) -> MutationLeaseRequest {
    MutationLeaseRequest {
        session_id: format!("session-{run_id}"),
        workspace_id: workspace_id.into(),
        run_id: run_id.into(),
        node_id: format!("node-{run_id}"),
        attempt_id: attempt_id.into(),
        action,
        occurred_at,
    }
}

#[test]
fn lease_is_workspace_scoped_atomic_and_restart_safe() {
    let store = TempStoreDir::new("squad-mutation-lease");
    let first = writer(&store);
    let owner = request(
        "/workspace/a",
        "one",
        "attempt-one",
        MutationLeaseAction::Acquire,
        1,
    );
    assert_eq!(
        first.change_mutation_lease(&owner).expect("acquire"),
        MutationLeaseOutcome::Acquired {
            epoch: 1,
            duplicate: false
        }
    );
    assert_eq!(
        first.change_mutation_lease(&owner).expect("duplicate"),
        MutationLeaseOutcome::Acquired {
            epoch: 1,
            duplicate: true
        }
    );
    let contender = request(
        "/workspace/a",
        "two",
        "attempt-two",
        MutationLeaseAction::Acquire,
        2,
    );
    assert!(matches!(
        first.change_mutation_lease(&contender).expect("busy"),
        MutationLeaseOutcome::Busy { epoch: 1, .. }
    ));
    let independent = request(
        "/workspace/b",
        "three",
        "attempt-three",
        MutationLeaseAction::Acquire,
        3,
    );
    assert!(matches!(
        first
            .change_mutation_lease(&independent)
            .expect("independent workspace"),
        MutationLeaseOutcome::Acquired { epoch: 1, .. }
    ));
    first.shutdown().expect("shutdown first writer");

    let reopened = writer(&store);
    assert!(matches!(
        reopened
            .change_mutation_lease(&contender)
            .expect("restart keeps owner"),
        MutationLeaseOutcome::Busy { epoch: 1, .. }
    ));
    let release = request(
        "/workspace/a",
        "one",
        "attempt-one",
        MutationLeaseAction::Release,
        4,
    );
    assert_eq!(
        reopened.change_mutation_lease(&release).expect("release"),
        MutationLeaseOutcome::Released {
            epoch: 1,
            duplicate: false
        }
    );
    assert!(matches!(
        reopened
            .change_mutation_lease(&contender)
            .expect("new epoch"),
        MutationLeaseOutcome::Acquired {
            epoch: 2,
            duplicate: false
        }
    ));
}

#[test]
fn lease_rejects_non_absolute_workspace_identity() {
    let store = TempStoreDir::new("squad-mutation-lease-relative-root");
    let lease_writer = writer(&store);
    let invalid = request(
        "workspace-uuid",
        "one",
        "attempt-one",
        MutationLeaseAction::Acquire,
        1,
    );

    let error = lease_writer
        .change_mutation_lease(&invalid)
        .expect_err("workspace UUID must never be accepted as a lease root");
    assert!(error
        .to_string()
        .contains("canonical absolute workspace root"));
    lease_writer.shutdown().expect("shutdown writer");
}
