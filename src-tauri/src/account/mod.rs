//! Doge-owned Account Convenience boundary.
//!
//! Remote identity remains authoritative in token2api. This module owns the
//! desktop-safe broker boundary, OS-vault credentials, safe local metadata,
//! configuration planning, and renderer-safe IPC projection.

mod authority;
mod authority_contract;
#[cfg(test)]
mod authority_desktop_tests;
mod broker;
pub(crate) mod configuration;
#[cfg(test)]
mod configuration_tests;
mod desktop_continuation;
#[cfg(test)]
mod desktop_continuation_tests;
mod event_buffer;
mod model;
mod persistence;
mod persistence_operations;
mod persistence_schema;
#[cfg(test)]
mod persistence_tests;
pub(crate) mod runtime;
pub(crate) mod runtime_ipc;
mod vault;

pub(crate) use runtime::AccountRuntime;

#[cfg(test)]
mod inventory_tests;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod wakeup_tests;

#[cfg(test)]
pub(crate) use broker::AccountBrokerV1;
// D7 consumes these at the shared IPC boundary. They are intentionally unused
// while this leaf is compiled as a standalone test crate.
#[allow(unused_imports)]
pub(crate) use model::{
    AccountBrokerRequestV1, AuthorityScopeV1, BrokerErrorV1, BrokerOperationIdV1, BrokerReceiptV1,
    CancellationPointV1, GatewayIntentIdV1, GatewayOperationV1, NextActionV1, RequestFingerprintV1,
    SessionEffectV1, TerminalOutcomeV1, TransportRequestIdV1,
};
