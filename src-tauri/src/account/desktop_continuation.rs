use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::time::{timeout, Duration, Instant};
use uuid::Uuid;
use zeroize::Zeroizing;

use super::authority::TOKEN_MATRIX_ORIGIN;

const LOOPBACK_CALLBACK_PREFIX: &str = "/doge-account/v1/callback/";
const MAX_CALLBACK_BYTES: usize = 8 * 1024;
const MAX_INVALID_CONNECTIONS: usize = 8;
const CALLBACK_READ_TIMEOUT: Duration = Duration::from_secs(2);
const MIN_TTL_SECONDS: i64 = 30;
const MAX_TTL_SECONDS: i64 = 600;
const TERMINAL_RETENTION_SECONDS: i64 = 600;
const MAX_ATTEMPTS: usize = 32;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DesktopContinuationPurpose {
    OAuth,
    IdentityBind,
    PasswordReset,
    HumanVerificationRegister,
    HumanVerificationLogin,
    HumanVerificationRegistrationCode,
    HumanVerificationPasswordReset,
}

impl DesktopContinuationPurpose {
    pub(super) fn handle_parts(self) -> (&'static str, &'static str) {
        match self {
            Self::OAuth => ("oauth-attempt", "oauth"),
            Self::IdentityBind => ("oauth-attempt", "oauth"),
            Self::PasswordReset => ("external-intent", "password-reset"),
            Self::HumanVerificationRegister => ("human-verification", "register"),
            Self::HumanVerificationLogin => ("human-verification", "login"),
            Self::HumanVerificationRegistrationCode => ("human-verification", "registration-code"),
            Self::HumanVerificationPasswordReset => ("human-verification", "password-reset"),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DesktopContinuationStatus {
    Waiting,
    Returned,
    Denied,
    Cancelled,
    Expired,
    StateMismatch,
    ProtocolRejected,
    Consumed,
}

pub(crate) struct DesktopContinuationStart {
    pub(crate) handle: String,
    pub(crate) expires_at: i64,
    pub(crate) callback_uri: Zeroizing<String>,
    pub(crate) state: Zeroizing<String>,
    pub(crate) nonce: Zeroizing<String>,
    pub(crate) pkce_challenge: String,
}

impl DesktopContinuationStart {
    pub(crate) fn expires_at(&self) -> i64 {
        self.expires_at
    }
}

pub(crate) struct DesktopExchangeMaterial {
    handle: String,
    ticket: Zeroizing<String>,
    pkce_verifier: Zeroizing<String>,
    nonce: Zeroizing<String>,
    callback_uri: Zeroizing<String>,
}

impl DesktopExchangeMaterial {
    pub(crate) fn handle(&self) -> &str {
        &self.handle
    }

    pub(crate) fn ticket(&self) -> &str {
        &self.ticket
    }

    pub(crate) fn pkce_verifier(&self) -> &str {
        &self.pkce_verifier
    }

    pub(crate) fn nonce(&self) -> &str {
        &self.nonce
    }

    pub(crate) fn callback_uri(&self) -> &str {
        &self.callback_uri
    }
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DesktopAuthorizationStartWire {
    pub(crate) authorization_id: String,
    pub(crate) authorize_url: String,
    pub(crate) expires_at: String,
}

#[derive(Clone)]
pub(crate) struct DesktopContinuationBroker {
    attempts: Arc<Mutex<HashMap<String, DesktopAttempt>>>,
    wakeups: broadcast::Sender<DesktopContinuationWakeup>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DesktopContinuationWakeup {
    pub(crate) handle: String,
    pub(crate) account_epoch: u64,
}

struct DesktopAttempt {
    purpose: DesktopContinuationPurpose,
    authority_origin: String,
    audience: String,
    device_id: String,
    account_epoch: u64,
    process_generation: u64,
    expires_at: i64,
    status: AttemptStatus,
    pkce_verifier: Zeroizing<String>,
    nonce: Zeroizing<String>,
    callback_uri: Zeroizing<String>,
    cancel: Option<oneshot::Sender<()>>,
    stopped: Option<oneshot::Receiver<()>>,
}

enum AttemptStatus {
    Waiting,
    Returned { ticket: Zeroizing<String> },
    Denied,
    Cancelled,
    Expired,
    StateMismatch,
    ProtocolRejected,
    Consumed,
}

impl AttemptStatus {
    fn view(&self) -> DesktopContinuationStatus {
        match self {
            Self::Waiting => DesktopContinuationStatus::Waiting,
            Self::Returned { .. } => DesktopContinuationStatus::Returned,
            Self::Denied => DesktopContinuationStatus::Denied,
            Self::Cancelled => DesktopContinuationStatus::Cancelled,
            Self::Expired => DesktopContinuationStatus::Expired,
            Self::StateMismatch => DesktopContinuationStatus::StateMismatch,
            Self::ProtocolRejected => DesktopContinuationStatus::ProtocolRejected,
            Self::Consumed => DesktopContinuationStatus::Consumed,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DesktopContinuationError {
    InvalidBinding,
    ListenerUnavailable,
    CapacityExceeded,
    AttemptMissing,
    AttemptNotReturned,
    AttemptExpired,
    BindingMismatch,
    Replay,
}

impl DesktopContinuationBroker {
    pub(crate) fn new() -> Self {
        let (wakeups, _) = broadcast::channel(32);
        Self {
            attempts: Arc::new(Mutex::new(HashMap::new())),
            wakeups,
        }
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<DesktopContinuationWakeup> {
        self.wakeups.subscribe()
    }

    pub(crate) async fn begin_loopback(
        &self,
        purpose: DesktopContinuationPurpose,
        authority_origin: &str,
        audience: &str,
        device_id: &str,
        account_epoch: u64,
        process_generation: u64,
        now_epoch: i64,
        ttl_seconds: i64,
    ) -> Result<DesktopContinuationStart, DesktopContinuationError> {
        if authority_origin != TOKEN_MATRIX_ORIGIN
            || !valid_binding(audience, device_id)
            || !(MIN_TTL_SECONDS..=MAX_TTL_SECONDS).contains(&ttl_seconds)
        {
            return Err(DesktopContinuationError::InvalidBinding);
        }
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| DesktopContinuationError::ListenerUnavailable)?;
        let address = listener
            .local_addr()
            .map_err(|_| DesktopContinuationError::ListenerUnavailable)?;
        let callback_nonce = random_token();
        let callback_path = format!("{LOOPBACK_CALLBACK_PREFIX}{callback_nonce}");
        let callback_uri = format!("http://{address}{callback_path}");
        let state = random_token();
        let state_digest = digest(&state);
        let nonce = Zeroizing::new(random_token());
        let pkce_verifier = Zeroizing::new(random_token());
        let pkce_challenge = URL_SAFE_NO_PAD.encode(digest(&pkce_verifier));
        let expires_at = now_epoch.saturating_add(ttl_seconds);
        let (kind, handle_purpose) = purpose.handle_parts();
        let handle = format!(
            "handle~{kind}~{handle_purpose}~e{account_epoch}~g{process_generation}~x{expires_at}~{}",
            Uuid::new_v4().simple()
        );
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let (stopped_tx, stopped_rx) = oneshot::channel();
        let mut attempts = self.attempts.lock().await;
        attempts.retain(|_, attempt| {
            matches!(
                attempt.status,
                AttemptStatus::Waiting | AttemptStatus::Returned { .. }
            ) || attempt.expires_at >= now_epoch.saturating_sub(TERMINAL_RETENTION_SECONDS)
        });
        if attempts.len() >= MAX_ATTEMPTS {
            return Err(DesktopContinuationError::CapacityExceeded);
        }
        attempts.insert(
            handle.clone(),
            DesktopAttempt {
                purpose,
                authority_origin: authority_origin.to_string(),
                audience: audience.to_string(),
                device_id: device_id.to_string(),
                account_epoch,
                process_generation,
                expires_at,
                status: AttemptStatus::Waiting,
                pkce_verifier: Zeroizing::new(pkce_verifier.to_string()),
                nonce: Zeroizing::new(nonce.to_string()),
                callback_uri: Zeroizing::new(callback_uri.clone()),
                cancel: Some(cancel_tx),
                stopped: Some(stopped_rx),
            },
        );
        drop(attempts);
        let attempts = Arc::clone(&self.attempts);
        let wakeups = self.wakeups.clone();
        let task_handle = handle.clone();
        tokio::spawn(async move {
            run_loopback_listener(
                listener,
                address.port(),
                callback_path,
                state_digest,
                task_handle,
                account_epoch,
                attempts,
                wakeups,
                cancel_rx,
                Duration::from_secs(ttl_seconds as u64),
            )
            .await;
            let _ = stopped_tx.send(());
        });
        Ok(DesktopContinuationStart {
            handle,
            expires_at,
            callback_uri: Zeroizing::new(callback_uri),
            state: Zeroizing::new(state),
            nonce,
            pkce_challenge,
        })
    }

    pub(crate) async fn read(
        &self,
        handle: &str,
        account_epoch: u64,
        process_generation: u64,
        now_epoch: i64,
    ) -> Result<DesktopContinuationStatus, DesktopContinuationError> {
        let mut attempts = self.attempts.lock().await;
        let attempt = attempts
            .get_mut(handle)
            .ok_or(DesktopContinuationError::AttemptMissing)?;
        require_attempt_binding(attempt, account_epoch, process_generation)?;
        expire_if_needed(attempt, now_epoch);
        Ok(attempt.status.view())
    }

    pub(crate) async fn is_waiting(
        &self,
        handle: &str,
        purpose: DesktopContinuationPurpose,
        authority_origin: &str,
        audience: &str,
        device_id: &str,
        account_epoch: u64,
        process_generation: u64,
        now_epoch: i64,
    ) -> Result<(), DesktopContinuationError> {
        let mut attempts = self.attempts.lock().await;
        let attempt = attempts
            .get_mut(handle)
            .ok_or(DesktopContinuationError::AttemptMissing)?;
        require_attempt_binding(attempt, account_epoch, process_generation)?;
        expire_if_needed(attempt, now_epoch);
        if attempt.purpose != purpose
            || attempt.authority_origin != authority_origin
            || attempt.audience != audience
            || attempt.device_id != device_id
        {
            return Err(DesktopContinuationError::BindingMismatch);
        }
        match attempt.status {
            AttemptStatus::Waiting => Ok(()),
            AttemptStatus::Expired => Err(DesktopContinuationError::AttemptExpired),
            AttemptStatus::Consumed => Err(DesktopContinuationError::Replay),
            _ => Err(DesktopContinuationError::AttemptNotReturned),
        }
    }

    pub(crate) async fn cancel(
        &self,
        handle: &str,
        account_epoch: u64,
        process_generation: u64,
    ) -> Result<(), DesktopContinuationError> {
        let stopped = {
            let mut attempts = self.attempts.lock().await;
            let attempt = attempts
                .get_mut(handle)
                .ok_or(DesktopContinuationError::AttemptMissing)?;
            require_attempt_binding(attempt, account_epoch, process_generation)?;
            match attempt.status {
                AttemptStatus::Waiting | AttemptStatus::Returned { .. } => {
                    attempt.status = AttemptStatus::Cancelled;
                    if let Some(cancel) = attempt.cancel.take() {
                        let _ = cancel.send(());
                    }
                    attempt.stopped.take()
                }
                AttemptStatus::Cancelled => None,
                AttemptStatus::Expired => return Err(DesktopContinuationError::AttemptExpired),
                AttemptStatus::Consumed => return Err(DesktopContinuationError::Replay),
                _ => return Err(DesktopContinuationError::AttemptNotReturned),
            }
        };
        if let Some(stopped) = stopped {
            let _ = timeout(Duration::from_secs(1), stopped).await;
        }
        Ok(())
    }

    pub(crate) async fn exchange_material(
        &self,
        handle: &str,
        purpose: DesktopContinuationPurpose,
        authority_origin: &str,
        audience: &str,
        device_id: &str,
        account_epoch: u64,
        process_generation: u64,
        now_epoch: i64,
    ) -> Result<DesktopExchangeMaterial, DesktopContinuationError> {
        let mut attempts = self.attempts.lock().await;
        let attempt = attempts
            .get_mut(handle)
            .ok_or(DesktopContinuationError::AttemptMissing)?;
        require_attempt_binding(attempt, account_epoch, process_generation)?;
        expire_if_needed(attempt, now_epoch);
        if attempt.purpose != purpose
            || attempt.authority_origin != authority_origin
            || attempt.audience != audience
            || attempt.device_id != device_id
        {
            return Err(DesktopContinuationError::BindingMismatch);
        }
        let AttemptStatus::Returned { ticket } = &attempt.status else {
            return Err(match attempt.status {
                AttemptStatus::Expired => DesktopContinuationError::AttemptExpired,
                AttemptStatus::Consumed => DesktopContinuationError::Replay,
                _ => DesktopContinuationError::AttemptNotReturned,
            });
        };
        Ok(DesktopExchangeMaterial {
            handle: handle.to_string(),
            ticket: Zeroizing::new(ticket.to_string()),
            pkce_verifier: Zeroizing::new(attempt.pkce_verifier.to_string()),
            nonce: Zeroizing::new(attempt.nonce.to_string()),
            callback_uri: Zeroizing::new(attempt.callback_uri.to_string()),
        })
    }

    pub(crate) async fn complete_exchange(
        &self,
        handle: &str,
        account_epoch: u64,
        process_generation: u64,
    ) -> Result<(), DesktopContinuationError> {
        let mut attempts = self.attempts.lock().await;
        let attempt = attempts
            .get_mut(handle)
            .ok_or(DesktopContinuationError::AttemptMissing)?;
        require_attempt_binding(attempt, account_epoch, process_generation)?;
        match attempt.status {
            AttemptStatus::Returned { .. } => {
                attempt.status = AttemptStatus::Consumed;
                attempt.cancel = None;
                attempt.stopped = None;
                Ok(())
            }
            AttemptStatus::Consumed => Err(DesktopContinuationError::Replay),
            AttemptStatus::Expired => Err(DesktopContinuationError::AttemptExpired),
            _ => Err(DesktopContinuationError::AttemptNotReturned),
        }
    }
}

fn valid_binding(audience: &str, device_id: &str) -> bool {
    audience == "doge-desktop"
        && (8..=128).contains(&device_id.len())
        && device_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
}

fn require_attempt_binding(
    attempt: &DesktopAttempt,
    account_epoch: u64,
    process_generation: u64,
) -> Result<(), DesktopContinuationError> {
    if attempt.account_epoch == account_epoch && attempt.process_generation == process_generation {
        Ok(())
    } else {
        Err(DesktopContinuationError::BindingMismatch)
    }
}

fn expire_if_needed(attempt: &mut DesktopAttempt, now_epoch: i64) {
    if attempt.expires_at <= now_epoch && matches!(attempt.status, AttemptStatus::Waiting) {
        attempt.status = AttemptStatus::Expired;
        if let Some(cancel) = attempt.cancel.take() {
            let _ = cancel.send(());
        }
    }
}

fn random_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn digest(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}

fn constant_time_equal(left: &[u8; 32], right: &[u8; 32]) -> bool {
    left.iter()
        .zip(right.iter())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

async fn run_loopback_listener(
    listener: TcpListener,
    expected_port: u16,
    expected_path: String,
    expected_state_digest: [u8; 32],
    handle: String,
    account_epoch: u64,
    attempts: Arc<Mutex<HashMap<String, DesktopAttempt>>>,
    wakeups: broadcast::Sender<DesktopContinuationWakeup>,
    mut cancel: oneshot::Receiver<()>,
    ttl: Duration,
) {
    let deadline = Instant::now() + ttl;
    let mut invalid_connections = 0_usize;
    loop {
        let accepted = tokio::select! {
            _ = &mut cancel => return,
            _ = tokio::time::sleep_until(deadline) => {
                settle_and_wake(
                    &attempts,
                    &wakeups,
                    &handle,
                    account_epoch,
                    AttemptStatus::Expired,
                ).await;
                return;
            }
            result = listener.accept() => result,
        };
        let Ok((stream, peer)) = accepted else {
            settle_and_wake(
                &attempts,
                &wakeups,
                &handle,
                account_epoch,
                AttemptStatus::ProtocolRejected,
            )
            .await;
            return;
        };
        if !peer.ip().is_loopback() {
            continue;
        }
        match read_callback(
            stream,
            expected_port,
            &expected_path,
            &expected_state_digest,
        )
        .await
        {
            CallbackRead::Ignore => {
                invalid_connections += 1;
                if invalid_connections >= MAX_INVALID_CONNECTIONS {
                    settle_and_wake(
                        &attempts,
                        &wakeups,
                        &handle,
                        account_epoch,
                        AttemptStatus::ProtocolRejected,
                    )
                    .await;
                    return;
                }
            }
            CallbackRead::Terminal(status) => {
                settle_and_wake(&attempts, &wakeups, &handle, account_epoch, status).await;
                return;
            }
        }
    }
}

async fn settle_and_wake(
    attempts: &Arc<Mutex<HashMap<String, DesktopAttempt>>>,
    wakeups: &broadcast::Sender<DesktopContinuationWakeup>,
    handle: &str,
    account_epoch: u64,
    status: AttemptStatus,
) {
    let mut attempts = attempts.lock().await;
    if let Some(attempt) = attempts.get_mut(handle) {
        if matches!(attempt.status, AttemptStatus::Waiting) {
            attempt.status = status;
            attempt.cancel = None;
            drop(attempts);
            let _ = wakeups.send(DesktopContinuationWakeup {
                handle: handle.to_string(),
                account_epoch,
            });
        }
    }
}

enum CallbackRead {
    Ignore,
    Terminal(AttemptStatus),
}

async fn read_callback(
    mut stream: TcpStream,
    expected_port: u16,
    expected_path: &str,
    expected_state_digest: &[u8; 32],
) -> CallbackRead {
    let mut bytes = Vec::new();
    let read_result = timeout(CALLBACK_READ_TIMEOUT, async {
        let mut chunk = [0_u8; 1024];
        loop {
            let count = stream.read(&mut chunk).await.map_err(|_| ())?;
            if count == 0 {
                return Err(());
            }
            if bytes.len().saturating_add(count) > MAX_CALLBACK_BYTES {
                return Err(());
            }
            bytes.extend_from_slice(&chunk[..count]);
            if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                return Ok(());
            }
        }
    })
    .await;
    if !matches!(read_result, Ok(Ok(()))) {
        let _ = write_browser_response(&mut stream, 400).await;
        return CallbackRead::Terminal(AttemptStatus::ProtocolRejected);
    }
    let Ok(request) = std::str::from_utf8(&bytes) else {
        let _ = write_browser_response(&mut stream, 400).await;
        return CallbackRead::Ignore;
    };
    let Some((request_head, _)) = request.split_once("\r\n\r\n") else {
        let _ = write_browser_response(&mut stream, 400).await;
        return CallbackRead::Ignore;
    };
    let mut lines = request_head.split("\r\n");
    let Some(request_line) = lines.next() else {
        let _ = write_browser_response(&mut stream, 400).await;
        return CallbackRead::Ignore;
    };
    let mut request_parts = request_line.split(' ');
    let method = request_parts.next();
    let target = request_parts.next();
    let version = request_parts.next();
    if method != Some("GET")
        || !matches!(version, Some("HTTP/1.1") | Some("HTTP/1.0"))
        || request_parts.next().is_some()
    {
        let _ = write_browser_response(&mut stream, 405).await;
        return CallbackRead::Ignore;
    }
    let mut host = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            let _ = write_browser_response(&mut stream, 400).await;
            return CallbackRead::Ignore;
        };
        if name.eq_ignore_ascii_case("host") {
            if host.is_some() {
                let _ = write_browser_response(&mut stream, 400).await;
                return CallbackRead::Ignore;
            }
            host = Some(value.trim());
        }
    }
    let expected_host = format!("127.0.0.1:{expected_port}");
    if host != Some(expected_host.as_str()) {
        let _ = write_browser_response(&mut stream, 400).await;
        return CallbackRead::Ignore;
    }
    let Some((path, raw_query)) = target.and_then(|target| target.split_once('?')) else {
        let _ = write_browser_response(&mut stream, 404).await;
        return CallbackRead::Ignore;
    };
    if path != expected_path {
        let _ = write_browser_response(&mut stream, 404).await;
        return CallbackRead::Ignore;
    }
    let Some(query) = parse_query(raw_query) else {
        let _ = write_browser_response(&mut stream, 400).await;
        return CallbackRead::Terminal(AttemptStatus::ProtocolRejected);
    };
    let Some(state) = query.get("state") else {
        let _ = write_browser_response(&mut stream, 400).await;
        return CallbackRead::Terminal(AttemptStatus::ProtocolRejected);
    };
    if !constant_time_equal(&digest(state), expected_state_digest) {
        let _ = write_browser_response(&mut stream, 400).await;
        return CallbackRead::Terminal(AttemptStatus::StateMismatch);
    }
    let outcome = match (query.get("ticket"), query.get("error")) {
        (Some(ticket), None) if valid_ticket(ticket) => AttemptStatus::Returned {
            ticket: Zeroizing::new(ticket.clone()),
        },
        (None, Some(error)) if matches!(error.as_str(), "access_denied" | "cancelled") => {
            AttemptStatus::Denied
        }
        _ => AttemptStatus::ProtocolRejected,
    };
    let status = if matches!(outcome, AttemptStatus::Returned { .. }) {
        200
    } else {
        400
    };
    let _ = write_browser_response(&mut stream, status).await;
    CallbackRead::Terminal(outcome)
}

pub(super) fn parse_query(raw: &str) -> Option<HashMap<String, String>> {
    let mut values = HashMap::new();
    for pair in raw.split('&') {
        let (name, value) = pair.split_once('=')?;
        if !matches!(name, "state" | "ticket" | "error") || values.contains_key(name) {
            return None;
        }
        let value = percent_decode(value)?;
        if value.len() > 2048 || value.chars().any(char::is_control) {
            return None;
        }
        values.insert(name.to_string(), value);
    }
    if values.len() == 2 && values.contains_key("state") {
        Some(values)
    } else {
        None
    }
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let high = hex_value(bytes[index + 1])?;
                let low = hex_value(bytes[index + 2])?;
                decoded.push((high << 4) | low);
                index += 3;
            }
            b'%' => return None,
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            value => {
                decoded.push(value);
                index += 1;
            }
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

pub(super) fn valid_ticket(value: &str) -> bool {
    (16..=2048).contains(&value.len())
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '~')
        })
}

async fn write_browser_response(stream: &mut TcpStream, status: u16) -> Result<(), ()> {
    let (status_text, body) = if status == 200 {
        ("200 OK", "Authorization received. Return to Doge.")
    } else if status == 404 {
        ("404 Not Found", "This authorization return is not active.")
    } else if status == 405 {
        (
            "405 Method Not Allowed",
            "This authorization return is not valid.",
        )
    } else {
        (
            "400 Bad Request",
            "This authorization return could not be accepted.",
        )
    };
    let response = format!(
        "HTTP/1.1 {status_text}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|_| ())?;
    stream.shutdown().await.map_err(|_| ())
}
