use super::authority::TOKEN_MATRIX_ORIGIN;
use super::desktop_continuation::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const NOW: i64 = 1_893_456_000;
const GENERATION: u64 = 17;
const EPOCH: u64 = 3;
const DEVICE: &str = "device_synthetic01";

async fn begin(broker: &DesktopContinuationBroker) -> DesktopContinuationStart {
    broker
        .begin_loopback(
            DesktopContinuationPurpose::OAuth,
            TOKEN_MATRIX_ORIGIN,
            "doge-desktop",
            DEVICE,
            EPOCH,
            GENERATION,
            NOW,
            60,
        )
        .await
        .expect("begin continuation")
}

async fn return_ticket(start: &DesktopContinuationStart, state: &str) -> reqwest::StatusCode {
    let url = format!(
        "{}?state={state}&ticket=synthetic-ticket-material-001",
        start.callback_uri.as_str()
    );
    reqwest::get(url).await.expect("loopback response").status()
}

#[tokio::test]
async fn valid_loopback_return_is_bound_and_one_time() {
    let broker = DesktopContinuationBroker::new();
    let mut wakeups = broker.subscribe();
    let start = begin(&broker).await;
    assert!(start.callback_uri.starts_with("http://127.0.0.1:"));
    assert!(!start.callback_uri.contains(&*start.state));
    assert_eq!(start.pkce_challenge.len(), 43);
    assert_eq!(
        return_ticket(&start, &start.state).await,
        reqwest::StatusCode::OK
    );
    assert_eq!(
        broker.read(&start.handle, EPOCH, GENERATION, NOW).await,
        Ok(DesktopContinuationStatus::Returned)
    );
    let material = broker
        .exchange_material(
            &start.handle,
            DesktopContinuationPurpose::OAuth,
            TOKEN_MATRIX_ORIGIN,
            "doge-desktop",
            DEVICE,
            EPOCH,
            GENERATION,
            NOW,
        )
        .await
        .expect("one-time material");
    assert_eq!(material.handle(), start.handle);
    assert_eq!(material.ticket(), "synthetic-ticket-material-001");
    assert_eq!(material.pkce_verifier().len(), 64);
    assert_eq!(material.nonce(), start.nonce.as_str());
    assert_eq!(material.callback_uri(), start.callback_uri.as_str());
    assert_eq!(
        wakeups.try_recv().expect("opaque OAuth wakeup"),
        DesktopContinuationWakeup {
            handle: start.handle.clone(),
            account_epoch: EPOCH,
        }
    );
    assert!(wakeups.try_recv().is_err());
    // A failed Authority call may safely retry the same one-time exchange
    // material with its stable idempotency key. Only durable session
    // activation commits the local continuation as consumed.
    assert!(broker
        .exchange_material(
            &start.handle,
            DesktopContinuationPurpose::OAuth,
            TOKEN_MATRIX_ORIGIN,
            "doge-desktop",
            DEVICE,
            EPOCH,
            GENERATION,
            NOW,
        )
        .await
        .is_ok());
    broker
        .complete_exchange(&start.handle, EPOCH, GENERATION)
        .await
        .expect("commit exchange");
    assert_eq!(
        broker
            .exchange_material(
                &start.handle,
                DesktopContinuationPurpose::OAuth,
                TOKEN_MATRIX_ORIGIN,
                "doge-desktop",
                DEVICE,
                EPOCH,
                GENERATION,
                NOW,
            )
            .await
            .err(),
        Some(DesktopContinuationError::Replay)
    );
}

#[tokio::test]
async fn wrong_state_settles_closed_without_exposing_ticket() {
    let broker = DesktopContinuationBroker::new();
    let start = begin(&broker).await;
    assert_eq!(
        return_ticket(&start, "wrong-state").await,
        reqwest::StatusCode::BAD_REQUEST
    );
    assert_eq!(
        broker.read(&start.handle, EPOCH, GENERATION, NOW).await,
        Ok(DesktopContinuationStatus::StateMismatch)
    );
    assert_eq!(
        broker
            .exchange_material(
                &start.handle,
                DesktopContinuationPurpose::OAuth,
                TOKEN_MATRIX_ORIGIN,
                "doge-desktop",
                DEVICE,
                EPOCH,
                GENERATION,
                NOW,
            )
            .await
            .err(),
        Some(DesktopContinuationError::AttemptNotReturned)
    );
}

#[tokio::test]
async fn cancel_wins_over_late_callback_and_is_idempotent() {
    let broker = DesktopContinuationBroker::new();
    let start = begin(&broker).await;
    broker
        .cancel(&start.handle, EPOCH, GENERATION)
        .await
        .expect("cancel");
    broker
        .cancel(&start.handle, EPOCH, GENERATION)
        .await
        .expect("idempotent cancel");
    assert_eq!(
        broker.read(&start.handle, EPOCH, GENERATION, NOW).await,
        Ok(DesktopContinuationStatus::Cancelled)
    );
    assert!(reqwest::get(format!(
        "{}?state={}&ticket=synthetic-ticket-material-001",
        start.callback_uri.as_str(),
        start.state.as_str()
    ))
    .await
    .is_err());
}

#[tokio::test]
async fn exchange_rejects_wrong_origin_audience_device_epoch_and_generation() {
    let broker = DesktopContinuationBroker::new();
    let start = begin(&broker).await;
    assert_eq!(
        return_ticket(&start, &start.state).await,
        reqwest::StatusCode::OK
    );
    for (origin, audience, device, epoch, generation) in [
        (
            "https://wrong.invalid",
            "doge-desktop",
            DEVICE,
            EPOCH,
            GENERATION,
        ),
        (
            TOKEN_MATRIX_ORIGIN,
            "other-audience",
            DEVICE,
            EPOCH,
            GENERATION,
        ),
        (
            TOKEN_MATRIX_ORIGIN,
            "doge-desktop",
            "device_wrong0001",
            EPOCH,
            GENERATION,
        ),
        (
            TOKEN_MATRIX_ORIGIN,
            "doge-desktop",
            DEVICE,
            EPOCH + 1,
            GENERATION,
        ),
        (
            TOKEN_MATRIX_ORIGIN,
            "doge-desktop",
            DEVICE,
            EPOCH,
            GENERATION + 1,
        ),
    ] {
        assert_eq!(
            broker
                .exchange_material(
                    &start.handle,
                    DesktopContinuationPurpose::OAuth,
                    origin,
                    audience,
                    device,
                    epoch,
                    generation,
                    NOW,
                )
                .await
                .err(),
            Some(DesktopContinuationError::BindingMismatch)
        );
    }
    assert!(broker
        .exchange_material(
            &start.handle,
            DesktopContinuationPurpose::OAuth,
            TOKEN_MATRIX_ORIGIN,
            "doge-desktop",
            DEVICE,
            EPOCH,
            GENERATION,
            NOW,
        )
        .await
        .is_ok());
}

#[tokio::test]
async fn deadline_and_oversize_request_settle_terminally() {
    let broker = DesktopContinuationBroker::new();
    let start = begin(&broker).await;
    assert_eq!(
        broker
            .read(&start.handle, EPOCH, GENERATION, NOW + 61)
            .await,
        Ok(DesktopContinuationStatus::Expired)
    );

    let start = begin(&broker).await;
    let address = start
        .callback_uri
        .strip_prefix("http://")
        .and_then(|value| value.split('/').next())
        .expect("loopback address");
    let mut stream = TcpStream::connect(address).await.expect("connect loopback");
    stream
        .write_all(&vec![b'a'; 8 * 1024 + 1])
        .await
        .expect("write oversized request");
    let mut response = Vec::new();
    let _ = stream.read_to_end(&mut response).await;
    assert_eq!(
        broker.read(&start.handle, EPOCH, GENERATION, NOW).await,
        Ok(DesktopContinuationStatus::ProtocolRejected)
    );
}

#[test]
fn callback_parser_rejects_duplicates_unknowns_and_unsafe_ticket_values() {
    assert!(parse_query("state=a&ticket=valid-ticket-value-001").is_some());
    assert!(parse_query("state=a&state=b").is_none());
    assert!(parse_query("state=a&ticket=b&extra=c").is_none());
    assert!(parse_query("state=a&ticket=%ZZ").is_none());
    assert!(!valid_ticket("short"));
    assert!(!valid_ticket("unsafe ticket material"));
}

#[test]
fn all_continuation_purposes_use_canonical_handle_namespaces() {
    assert_eq!(
        DesktopContinuationPurpose::IdentityBind.handle_parts(),
        ("oauth-attempt", "oauth")
    );
    assert_eq!(
        DesktopContinuationPurpose::PasswordReset.handle_parts(),
        ("external-intent", "password-reset")
    );
    assert_eq!(
        DesktopContinuationPurpose::HumanVerificationRegister.handle_parts(),
        ("human-verification", "register")
    );
    assert_eq!(
        DesktopContinuationPurpose::HumanVerificationLogin.handle_parts(),
        ("human-verification", "login")
    );
    assert_eq!(
        DesktopContinuationPurpose::HumanVerificationRegistrationCode.handle_parts(),
        ("human-verification", "registration-code")
    );
    assert_eq!(
        DesktopContinuationPurpose::HumanVerificationPasswordReset.handle_parts(),
        ("human-verification", "password-reset")
    );
}

#[tokio::test]
async fn begin_rejects_untrusted_origin_binding_and_ttl() {
    let broker = DesktopContinuationBroker::new();
    for (origin, audience, device, ttl) in [
        ("https://wrong.invalid", "doge-desktop", DEVICE, 60),
        (TOKEN_MATRIX_ORIGIN, "web", DEVICE, 60),
        (TOKEN_MATRIX_ORIGIN, "doge-desktop", "../device", 60),
        (TOKEN_MATRIX_ORIGIN, "doge-desktop", DEVICE, 29),
        (TOKEN_MATRIX_ORIGIN, "doge-desktop", DEVICE, 601),
    ] {
        assert_eq!(
            broker
                .begin_loopback(
                    DesktopContinuationPurpose::OAuth,
                    origin,
                    audience,
                    device,
                    EPOCH,
                    GENERATION,
                    NOW,
                    ttl,
                )
                .await
                .err(),
            Some(DesktopContinuationError::InvalidBinding)
        );
    }
}

#[tokio::test]
async fn process_restart_invalidates_old_handle_without_persisting_secrets() {
    let old_process = DesktopContinuationBroker::new();
    let start = begin(&old_process).await;
    let restarted_process = DesktopContinuationBroker::new();

    assert_eq!(
        restarted_process
            .read(&start.handle, EPOCH, GENERATION + 1, NOW)
            .await
            .err(),
        Some(DesktopContinuationError::AttemptMissing),
    );
    old_process
        .cancel(&start.handle, EPOCH, GENERATION)
        .await
        .expect("stop old listener");
}
