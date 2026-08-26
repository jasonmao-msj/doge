use super::*;
use crate::account::authority::{
    ProductApiKeyCreatedWire, ProductApiKeyListWire, TokenMatrixAuthority,
};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub(super) async fn resolve_product_key_secret(
    authority: &TokenMatrixAuthority,
    access: &str,
    group_id: i64,
    key_name: &str,
    device_id: &str,
    operation_id: &str,
) -> Result<String, Value> {
    let listed = authority
        .product_api_keys(access, group_id)
        .await
        .map_err(|error| authority_failure(error, "productPrepare"))?;
    if let Some(existing_key_id) = active_product_key_id(&listed, group_id, key_name) {
        return handoff_product_key_secret(
            authority,
            access,
            existing_key_id,
            device_id,
            operation_id,
            "productPrepare",
        )
        .await;
    }

    match authority
        .create_product_api_key(access, group_id, key_name, operation_id)
        .await
    {
        Ok(created) if valid_created_product_key(&created, group_id) => Ok(created.secret),
        outcome => {
            let create_failure = match outcome {
                Ok(_) => protocol_failure("productPrepare"),
                Err(error)
                    if matches!(
                        error.safe.code.as_str(),
                        "protocolMismatch" | "serviceUnavailable"
                    ) =>
                {
                    authority_failure(error, "productPrepare")
                }
                Err(error) => return Err(authority_failure(error, "productPrepare")),
            };
            reconcile_uncertain_product_key_create(
                authority,
                access,
                group_id,
                key_name,
                device_id,
                operation_id,
            )
            .await?
            .ok_or(create_failure)
        }
    }
}

async fn reconcile_uncertain_product_key_create(
    authority: &TokenMatrixAuthority,
    access: &str,
    group_id: i64,
    key_name: &str,
    device_id: &str,
    operation_id: &str,
) -> Result<Option<String>, Value> {
    // token2api may have committed the deterministic key before its response
    // was lost or rejected. Re-list in the same prepare attempt so a renderer
    // retry is not required merely to observe that side effect.
    let reconciled = authority
        .product_api_keys(access, group_id)
        .await
        .map_err(|error| authority_failure(error, "productPrepareReconcile"))?;
    let Some(reconciled_key_id) = active_product_key_id(&reconciled, group_id, key_name) else {
        return Ok(None);
    };
    handoff_product_key_secret(
        authority,
        access,
        reconciled_key_id,
        device_id,
        operation_id,
        "productPrepareReconcile",
    )
    .await
    .map(Some)
}

async fn handoff_product_key_secret(
    authority: &TokenMatrixAuthority,
    access: &str,
    key_id: i64,
    device_id: &str,
    operation_id: &str,
    stage: &str,
) -> Result<String, Value> {
    match authority
        .handoff_api_key(access, key_id, device_id, operation_id)
        .await
    {
        Ok(value) if value.id == key_id && valid_product_key_secret(&value.secret) => {
            Ok(value.secret)
        }
        Ok(_) => Err(protocol_failure(stage)),
        Err(error) => Err(authority_failure(error, stage)),
    }
}

pub(super) fn managed_product_key_name(group_id: i64, device_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"doge-product-managed-key-v1\0");
    hasher.update(group_id.to_be_bytes());
    hasher.update(device_id.as_bytes());
    let fingerprint = format!("{:x}", hasher.finalize());
    format!("Doge Managed {group_id} {}", &fingerprint[..24])
}

pub(super) fn valid_created_product_key(value: &ProductApiKeyCreatedWire, group_id: i64) -> bool {
    value.id > 0 && value.group_id == Some(group_id) && valid_product_key_secret(&value.secret)
}

pub(super) fn active_product_key_id(
    value: &ProductApiKeyListWire,
    group_id: i64,
    key_name: &str,
) -> Option<i64> {
    value
        .items
        .iter()
        .find(|key| {
            key.id > 0
                && key.group_id == Some(group_id)
                && key.name == key_name
                && key.status.eq_ignore_ascii_case("active")
        })
        .map(|key| key.id)
}

fn valid_product_key_secret(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 4_096
}
