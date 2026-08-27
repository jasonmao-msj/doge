use super::runtime_product::*;
use super::runtime_product_keys::*;
use super::runtime_product_models::*;
use crate::account::authority::{
    ProductApiKeyCreatedWire, ProductApiKeyListItemWire, ProductApiKeyListWire, ProductModelWire,
    ProductPaymentMethodWire, ProductSubscriptionPlanWire,
};
use serde_json::json;

fn product_plan() -> ProductSubscriptionPlanWire {
    ProductSubscriptionPlanWire {
        id: 5,
        group_id: 11,
        group_platform: "composite".into(),
        group_name: "Doge".into(),
        name: "Doge Pro".into(),
        description: "All models".into(),
        price: 12.0,
        original_price: Some(16.0),
        validity_days: 30,
        validity_unit: "day".into(),
        features: vec!["All models".into()],
        daily_limit_usd: Some(2.0),
        weekly_limit_usd: Some(8.0),
        monthly_limit_usd: Some(20.0),
    }
}

fn product_model(id: &str) -> ProductModelWire {
    ProductModelWire {
        id: id.into(),
        display_name: None,
        model: None,
        compatible_engines: None,
        api_protocols: None,
        capabilities: None,
    }
}

#[test]
fn order_status_projection_is_closed() {
    assert_eq!(normalize_order_status("completed"), Some("paid"));
    assert_eq!(normalize_order_status("cancelled"), Some("cancelled"));
    assert_eq!(normalize_order_status("refunded"), Some("failed"));
    assert_eq!(normalize_order_status("partially_refunded"), Some("failed"));
    assert_eq!(normalize_order_status("unknown"), None);
}

#[test]
fn managed_product_key_identity_is_stable_per_group_and_device() {
    let first = managed_product_key_name(11, "device-primary-12345678");
    let repeated = managed_product_key_name(11, "device-primary-12345678");
    let other_device = managed_product_key_name(11, "device-secondary-87654321");
    let other_group = managed_product_key_name(12, "device-primary-12345678");

    assert_eq!(first, repeated);
    assert_ne!(first, other_device);
    assert_ne!(first, other_group);
    assert!(first.starts_with("Doge Managed 11 "));
    assert!(!first.contains("device-primary"));
    assert!(!first.contains(&product_plan().name));
}

#[test]
fn product_key_create_requires_exact_group_and_usable_secret() {
    let valid = ProductApiKeyCreatedWire {
        id: 17,
        group_id: Some(11),
        secret: "sk-product-secret".into(),
    };
    assert!(valid_created_product_key(&valid, 11));
    assert!(!valid_created_product_key(
        &ProductApiKeyCreatedWire {
            group_id: Some(12),
            ..valid.clone()
        },
        11
    ));
    assert!(!valid_created_product_key(
        &ProductApiKeyCreatedWire {
            secret: String::new(),
            ..valid
        },
        11
    ));
    assert!(!valid_created_product_key(
        &ProductApiKeyCreatedWire {
            id: 0,
            group_id: Some(11),
            secret: "sk-product-secret".into(),
        },
        11
    ));
}

#[test]
fn product_key_reconcile_selects_only_exact_active_identity() {
    let listed = ProductApiKeyListWire {
        items: vec![
            ProductApiKeyListItemWire {
                id: 1,
                name: "Doge Managed 11 wrong-device".into(),
                group_id: Some(11),
                status: "active".into(),
            },
            ProductApiKeyListItemWire {
                id: 2,
                name: "Doge Managed 11 exact".into(),
                group_id: Some(12),
                status: "active".into(),
            },
            ProductApiKeyListItemWire {
                id: 3,
                name: "Doge Managed 11 exact".into(),
                group_id: Some(11),
                status: "inactive".into(),
            },
            ProductApiKeyListItemWire {
                id: 0,
                name: "Doge Managed 11 exact".into(),
                group_id: Some(11),
                status: "active".into(),
            },
            ProductApiKeyListItemWire {
                id: 4,
                name: "Doge Managed 11 exact".into(),
                group_id: Some(11),
                status: "ACTIVE".into(),
            },
        ],
    };

    assert_eq!(
        active_product_key_id(&listed, 11, "Doge Managed 11 exact"),
        Some(4)
    );
    assert_eq!(
        active_product_key_id(&listed, 11, "Doge Managed 11 absent"),
        None
    );
}

#[test]
fn product_models_are_unicode_safe_ordered_and_deduplicated() {
    let models = safe_product_models(vec![
        product_model("豆包"),
        product_model("gpt-5.6-sol"),
        product_model("豆包"),
    ])
    .expect("safe product models");
    assert_eq!(models.len(), 2);
    assert!(models.iter().any(|value| value["id"] == "豆包"));
    assert_eq!(models[0]["id"], "豆包", "upstream order is preserved");
}

#[test]
fn product_models_preserve_dynamic_display_runtime_and_protocol_metadata() {
    let models = safe_product_models(vec![
        ProductModelWire {
            id: "doubao-entry".into(),
            display_name: Some("豆包".into()),
            model: Some("ark-code-latest".into()),
            compatible_engines: None,
            api_protocols: Some(vec!["responses".into(), "anthropic-messages".into()]),
            capabilities: Some(vec!["chat".into()]),
        },
        product_model("claude-opus-4-8"),
    ])
    .expect("safe product models");

    assert_eq!(models.len(), 2);
    assert_eq!(models[0]["id"], "doubao-entry");
    assert_eq!(models[0]["display_name"], "豆包");
    assert_eq!(models[0]["model"], "ark-code-latest");
    assert_eq!(
        models[0]["api_protocols"],
        json!(["openai-responses", "anthropic-messages"])
    );
    assert_eq!(models[1]["api_protocols"], json!(["anthropic-messages"]));
}

#[test]
fn explicit_openai_alias_is_chat_completions_not_responses() {
    let models = safe_product_models(vec![ProductModelWire {
        id: "custom-openai-compatible".into(),
        display_name: None,
        model: None,
        compatible_engines: None,
        api_protocols: Some(vec!["openai".into()]),
        capabilities: Some(vec!["chat".into()]),
    }])
    .expect("safe explicit OpenAI-compatible model");

    assert_eq!(
        models[0]["api_protocols"],
        json!(["openai-chat-completions"])
    );
}

#[test]
fn product_models_follow_new_ids_within_known_engine_families() {
    let models = safe_product_models(vec![
        product_model("gpt-5.7-future"),
        product_model("claude-sonnet-5-1"),
        product_model("kimi-for-coding-ultra"),
        product_model("unclassified-future-model"),
    ])
    .expect("known dynamic families remain");

    assert_eq!(models.len(), 3);
    assert_eq!(
        models[0]["api_protocols"],
        json!(["openai-responses", "openai-chat-completions"])
    );
    assert_eq!(models[1]["api_protocols"], json!(["anthropic-messages"]));
    assert_eq!(
        models[2]["api_protocols"],
        json!(["openai-responses", "openai-chat-completions"])
    );
}

#[test]
fn k3_family_fallback_supports_both_openai_endpoints() {
    let models = safe_product_models(vec![product_model("k3-256k")]).expect("safe K3 model");

    assert_eq!(
        models[0]["api_protocols"],
        json!(["openai-responses", "openai-chat-completions"])
    );
}

#[test]
fn legacy_engine_metadata_maps_to_api_protocol_families() {
    let models = safe_product_models(vec![
        ProductModelWire {
            id: "kimi-for-coding".into(),
            display_name: None,
            model: None,
            compatible_engines: Some(vec!["kimi".into()]),
            api_protocols: None,
            capabilities: Some(vec!["chat".into()]),
        },
        ProductModelWire {
            id: "claude-opus-4-8".into(),
            display_name: None,
            model: None,
            compatible_engines: Some(vec!["claude-code".into()]),
            api_protocols: None,
            capabilities: Some(vec!["messages".into()]),
        },
    ])
    .expect("legacy metadata maps to protocols");

    assert_eq!(
        models[0]["api_protocols"],
        json!(["openai-chat-completions"])
    );
    assert_eq!(models[1]["api_protocols"], json!(["anthropic-messages"]));
}

#[test]
fn explicit_unknown_protocol_fails_closed_without_family_fallback() {
    assert!(safe_product_models(vec![ProductModelWire {
        id: "gpt-5.7-future".into(),
        display_name: None,
        model: None,
        compatible_engines: Some(vec!["codex".into()]),
        api_protocols: Some(vec!["future-wire".into()]),
        capabilities: Some(vec!["chat".into()]),
    }])
    .is_err());
}

#[test]
fn product_models_exclude_explicit_and_legacy_non_conversation_rows() {
    let models = safe_product_models(vec![
        product_model("gpt-image-2"),
        product_model("gpt-4o-audio-preview"),
        product_model("gpt-4o-realtime-preview"),
        ProductModelWire {
            id: "multimodal-chat".into(),
            display_name: Some("Multimodal Chat".into()),
            model: None,
            compatible_engines: Some(vec!["codex".into(), "claude".into(), "kimi".into()]),
            api_protocols: None,
            capabilities: Some(vec!["chat".into(), "image".into()]),
        },
        ProductModelWire {
            id: "embed-v2".into(),
            display_name: None,
            model: None,
            compatible_engines: None,
            api_protocols: None,
            capabilities: Some(vec!["embeddings".into()]),
        },
    ])
    .expect("conversation row remains");

    assert_eq!(models.len(), 1);
    assert_eq!(models[0]["id"], "multimodal-chat");
}

#[test]
fn payment_navigation_requires_safe_https() {
    assert!(safe_payment_url("https://pay.example.com/order/1").is_some());
    assert!(safe_payment_url("http://pay.example.com/order/1").is_none());
    assert!(safe_payment_url("javascript:alert(1)").is_none());
}

#[test]
fn standard_payment_method_may_omit_display_name() {
    assert!(valid_payment_method(
        "alipay",
        &ProductPaymentMethodWire {
            payment_type: "alipay".into(),
            display_name: String::new(),
            currency: "CNY".into(),
        },
    ));
}

#[test]
fn product_plan_projection_contains_every_renderer_required_field() {
    let view = product_plan_value(&product_plan());
    assert_eq!(view["currency"], "USD");
    assert_eq!(view["validity_unit"], "day");
    assert_eq!(view["features"], json!(["All models"]));
    assert_eq!(view["original_price"], 16.0);
    assert_eq!(view["monthly_limit_usd"], 20.0);
}

#[test]
fn paid_checkout_remains_as_a_bounded_fulfillment_checkpoint() {
    let now = 1_893_456_000;
    assert_eq!(
        product_checkout_checkpoint("paid", now + 30, now),
        Some(("processing", now + PRODUCT_FULFILLMENT_GRACE_SECONDS))
    );
    assert_eq!(
        product_checkout_checkpoint("pending", now + 60, now),
        Some(("pending", now + 60))
    );
    assert_eq!(
        product_checkout_checkpoint("cancelled", now + 60, now),
        None
    );
}
