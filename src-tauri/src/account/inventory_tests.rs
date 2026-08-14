use super::model::{
    AuthorityScopeV1, GatewayOperationV1, NextActionV1, SessionEffectV1, TerminalOutcomeV1,
};

#[test]
fn illegal_receipt_combinations_fail_the_internal_matrix() {
    let operation_id = super::model::BrokerOperationIdV1::parse("operation_matrix0001").unwrap();
    let invalid = super::model::BrokerReceiptV1 {
        operation_id,
        operation: GatewayOperationV1::AuthLogin,
        terminal: TerminalOutcomeV1::CancelledBeforeSend,
        authority_scope: AuthorityScopeV1::Confirmed,
        session_effect: SessionEffectV1::Activated,
        next_action: NextActionV1::Reconcile,
        safe_projection_handle: None,
    };
    assert!(!invalid.has_legal_terminal_combination());
}

#[test]
fn leaf_operation_inventory_matches_current_canonical_gateway_source() {
    let gateway_source = include_str!("../../../src/features/account/contracts/gateway.ts");
    let inventory = gateway_source
        .split("export const ACCOUNT_GATEWAY_OPERATION_NAMES_V1 = [")
        .nth(1)
        .and_then(|suffix| suffix.split("] as const;").next())
        .expect("canonical gateway operation inventory");
    let canonical: std::collections::BTreeSet<_> = inventory
        .lines()
        .filter_map(|line| line.trim().strip_prefix('"'))
        .filter_map(|line| line.strip_suffix("\","))
        .collect();
    let leaf: std::collections::BTreeSet<_> = super::model::GATEWAY_OPERATIONS_V1
        .iter()
        .map(|operation| operation.as_contract_name())
        .collect();
    assert_eq!(leaf, canonical);
}
