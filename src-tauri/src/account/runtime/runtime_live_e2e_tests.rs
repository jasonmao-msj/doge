use super::*;
use crate::account::vault::tests::MemoryVault;

fn live_runtime(data_dir: &Path, origin: String) -> AccountRuntime {
    let repository = AccountRepository::open(data_dir.join("account-v1.sqlite3"))
        .expect("open isolated Account repository");
    let device_id = repository
        .load_or_create_device_id(now_epoch())
        .expect("create isolated device id");
    AccountRuntime {
        enabled: true,
        authority: Some(TokenMatrixAuthority::new_for_protocol_test(
            origin,
            Some("/api/v1/desktop/v1/authority"),
        )),
        repository: Some(repository),
        vault: Arc::new(MemoryVault::default()),
        state: Mutex::new(RuntimeState {
            initialized: false,
            account_epoch: 1,
            access_token: None,
            access_expires_at: 0,
            profile: None,
            public_settings: None,
            authority_descriptor: None,
            authority_contract_fetched_at: 0,
            metadata: None,
            registration_attempts: HashMap::new(),
            mfa_attempts: HashMap::new(),
            desktop_authorizations: HashMap::new(),
            api_key_candidates: HashMap::new(),
            configuration_plan: None,
            configuration_result: None,
        }),
        device_id: Some(device_id),
        process_generation: random_process_generation(),
        event_sequence: Arc::new(AtomicU64::new(0)),
        desktop_continuations: DesktopContinuationBroker::new(),
    }
}

fn request(
    runtime: &AccountRuntime,
    operation: &str,
    kind: &str,
    suffix: &str,
    payload: Value,
) -> Value {
    let mut value = json!({
        "contractId": CONTRACT_ID,
        "contractVersion": CONTRACT_VERSION,
        "requestId": format!("request_{suffix}"),
        "operation": operation,
        "kind": kind,
        "processGeneration": runtime.process_generation,
        "accountEpoch": 1,
        "payload": payload,
    });
    if kind == "mutation" {
        value["intentId"] = Value::String(format!("intent_{suffix}"));
    }
    value
}

async fn execute_read(
    runtime: &AccountRuntime,
    operation: &str,
    suffix: &str,
    payload: Value,
) -> Value {
    runtime
        .execute(request(runtime, operation, "read", suffix, payload), None)
        .await
        .expect("execute Account read")
}

async fn execute_mutation(
    runtime: &AccountRuntime,
    operation: &str,
    suffix: &str,
    payload: Value,
) -> Value {
    let request = request(runtime, operation, "mutation", suffix, payload);
    let operation_id = runtime
        .prepare_mutation(&request)
        .await
        .expect("prepare Account mutation");
    runtime
        .execute(request, Some(operation_id))
        .await
        .expect("execute Account mutation")
}

#[tokio::test]
#[ignore = "requires an isolated live token2api authority"]
async fn live_runtime_selects_existing_key_without_renderer_secret() {
    let origin = std::env::var("DOGE_ACCOUNT_E2E_ORIGIN").expect("live Authority origin");
    let email = std::env::var("DOGE_ACCOUNT_E2E_EMAIL").expect("live Authority email");
    let password = std::env::var("DOGE_ACCOUNT_E2E_PASSWORD").expect("live Authority password");
    let data_dir = std::env::temp_dir().join(format!(
        "doge-account-runtime-e2e-{}",
        Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&data_dir).expect("create isolated Account data directory");
    let runtime = live_runtime(&data_dir, origin);

    let bootstrap = execute_read(&runtime, "gateway.bootstrap", "liveboot01", Value::Null).await;
    assert_eq!(bootstrap["ok"], true);
    assert_eq!(
        bootstrap["value"]["capabilities"]["entries"]["managedKey.selectExisting"]["status"],
        "enabled"
    );

    let login = execute_mutation(
        &runtime,
        "auth.login",
        "livelogin01",
        json!({ "email": email, "password": password }),
    )
    .await;
    assert_eq!(login["ok"], true);
    assert_eq!(login["value"]["next"], "authenticated");

    let list = execute_read(
        &runtime,
        "managedKey.listCandidates",
        "livekeys01",
        json!({ "recipeId": ACCOUNT_RECIPE_ID, "recipeVersion": 1 }),
    )
    .await;
    assert_eq!(list["ok"], true);
    let selected = list["value"]["keys"]
        .as_array()
        .and_then(|keys| {
            keys.iter()
                .find(|key| key["status"] == "active" && key["availability"] == "selectable")
        })
        .and_then(|key| key["key"].as_str())
        .expect("renderer-safe selectable key handle")
        .to_string();
    assert!(!list.to_string().contains("secret"));

    let selection = execute_mutation(
        &runtime,
        "managedKey.selectExisting",
        "liveselect01",
        json!({
            "recipeId": ACCOUNT_RECIPE_ID,
            "recipeVersion": 1,
            "key": selected,
            "consent": "useSelectedApiKey",
        }),
    )
    .await;
    assert_eq!(selection["ok"], true);
    assert_eq!(selection["value"]["status"], "ready");
    assert!(!selection.to_string().contains("secret"));
    let native_key = runtime
        .managed_codex_key_for_launch()
        .await
        .expect("Native vault received selected key");
    assert!(!native_key.is_empty());
}
