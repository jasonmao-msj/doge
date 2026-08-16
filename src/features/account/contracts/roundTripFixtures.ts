import { AUTHORITY_OPERATION_NAMES_V1 } from "./authority";
import { ACCOUNT_GATEWAY_EVENT_KINDS_V1 } from "./gateway";
import { ACCOUNT_OPERATION_PROJECTIONS_V1 } from "./laneProjection";
import {
  ACCOUNT_IPC_CONTRACT_V1,
  TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1,
} from "./semantic";

export type AccountCrossLayerRoundTripFixtureV1 = {
  readonly fixtureId: string;
  readonly target: "typescript-ipc" | "rust-broker" | "authority-wire";
  readonly contractRef: { readonly id: string; readonly version: "1.0.0" };
  readonly operation: string;
  readonly semantics: {
    readonly optionalFields: "omitted-unless-present";
    readonly nullableFields: "explicit-null-preserved";
    readonly decimalValues: "canonical-non-negative-string";
    readonly semver: "major-minor-patch-string";
  };
};

const ROUND_TRIP_SEMANTICS_V1 = {
  optionalFields: "omitted-unless-present",
  nullableFields: "explicit-null-preserved",
  decimalValues: "canonical-non-negative-string",
  semver: "major-minor-patch-string",
} as const;

const gatewayRoundTripsV1: readonly AccountCrossLayerRoundTripFixtureV1[] =
  ACCOUNT_OPERATION_PROJECTIONS_V1.map(({ gatewayOperation }) => ({
    fixtureId: `typescript-ipc.${gatewayOperation}`,
    target: "typescript-ipc",
    contractRef: ACCOUNT_IPC_CONTRACT_V1,
    operation: gatewayOperation,
    semantics: ROUND_TRIP_SEMANTICS_V1,
  }));

const brokerRoundTripsV1: readonly AccountCrossLayerRoundTripFixtureV1[] =
  ACCOUNT_OPERATION_PROJECTIONS_V1.map(({ gatewayOperation }) => ({
    fixtureId: `rust-broker.${gatewayOperation}`,
    target: "rust-broker",
    contractRef: { id: "doge-account-broker", version: "1.0.0" },
    operation: gatewayOperation,
    semantics: ROUND_TRIP_SEMANTICS_V1,
  }));

const authorityRoundTripsV1: readonly AccountCrossLayerRoundTripFixtureV1[] =
  AUTHORITY_OPERATION_NAMES_V1.map((operation) => ({
    fixtureId: `authority-wire.${operation}`,
    target: "authority-wire",
    contractRef: TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1,
    operation,
    semantics: ROUND_TRIP_SEMANTICS_V1,
  }));

const eventRoundTripsV1: readonly AccountCrossLayerRoundTripFixtureV1[] =
  ACCOUNT_GATEWAY_EVENT_KINDS_V1.map((eventKind) => ({
    fixtureId: `typescript-ipc.event.${eventKind}`,
    target: "typescript-ipc",
    contractRef: ACCOUNT_IPC_CONTRACT_V1,
    operation: `event.${eventKind}`,
    semantics: ROUND_TRIP_SEMANTICS_V1,
  }));

/**
 * Language-neutral data consumed by TS tests now and serializable unchanged for
 * future Rust/Authority conformance runners. It contains no implementation DTO.
 */
export const ACCOUNT_CROSS_LAYER_ROUND_TRIP_FIXTURES_V1:
  readonly AccountCrossLayerRoundTripFixtureV1[] = [
    ...gatewayRoundTripsV1,
    ...eventRoundTripsV1,
    ...brokerRoundTripsV1,
    ...authorityRoundTripsV1,
  ];
