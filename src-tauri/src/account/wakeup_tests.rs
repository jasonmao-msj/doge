use super::event_buffer::{AccountWakeupBufferV1, AccountWakeupEventV1, AccountWakeupKindV1};
use super::model::{BrokerErrorV1, CancellationPointV1, GatewayOperationV1};
use super::test_support::{InMemoryEpochFenceV1, ManualClockV1};
use super::tests::{default_broker, request};

#[test]
fn stale_process_generation_fails_before_repository_or_authority() {
    let mut broker = default_broker(ManualClockV1::new(96), InMemoryEpochFenceV1::new(Some(1)));
    let mut stale = request(
        "staleProcReq1",
        "staleProcInt1",
        GatewayOperationV1::ProfileRead,
        Some(1),
        'd',
    );
    stale.process_generation = 2;
    let result = broker.execute(stale, CancellationPointV1::None);
    assert_eq!(result, Err(BrokerErrorV1::StaleProcessGeneration));
    assert_eq!(broker.authority().execute_calls(), 0);
}

#[test]
fn wakeup_buffer_rejects_old_generation_duplicate_and_zero_sequence() {
    let mut buffer = AccountWakeupBufferV1::new(5).expect("nonzero process generation");
    assert!(AccountWakeupBufferV1::new(0).is_none());
    let first = buffer.publish(AccountWakeupKindV1::SessionChanged, Some(3));
    let second = buffer.publish(AccountWakeupKindV1::UsageInvalidated, Some(3));
    assert_eq!(first.event_seq, 1);
    assert_eq!(second.event_seq, 2);
    assert_eq!(first.kind, AccountWakeupKindV1::SessionChanged);
    assert_eq!(first.account_epoch, Some(3));
    assert!(buffer.accept_wakeup(first, Some(3)));
    assert!(!buffer.accept_wakeup(first, Some(3)));
    assert!(!buffer.accept_wakeup(
        AccountWakeupEventV1 {
            kind: AccountWakeupKindV1::CapabilitiesChanged,
            process_generation: 4,
            event_seq: 3,
            account_epoch: Some(3),
        },
        Some(3),
    ));
    assert!(!buffer.accept_wakeup(
        AccountWakeupEventV1 {
            kind: AccountWakeupKindV1::OauthAttemptChanged,
            process_generation: 5,
            event_seq: 0,
            account_epoch: Some(3),
        },
        Some(3),
    ));
    assert!(!buffer.accept_wakeup(second, Some(4)));
    assert!(buffer.accept_wakeup(second, Some(3)));
    for kind in [
        AccountWakeupKindV1::ExternalIntentReady,
        AccountWakeupKindV1::ConfigurationTaskChanged,
    ] {
        assert_eq!(buffer.publish(kind, None).kind, kind);
    }
}
