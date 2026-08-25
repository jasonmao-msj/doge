import type { AccountExperienceControllerV1 } from "../hooks/useAccountExperienceController";
import { useProductAccountDetailsV1 } from "../hooks/useProductAccountDetails";
import { useProductEntitlementSnapshotV1 } from "../runtime/productEntitlementStore";
import { AccountCenterHeader } from "./AccountCenterHeader";
import { ProductAccountDetails } from "./ProductAccountDetails";

export type AccountCenterProps = {
  readonly controller: AccountExperienceControllerV1;
  readonly showLegacyConfiguration: boolean;
};

export function AccountCenter({
  controller,
  showLegacyConfiguration,
}: AccountCenterProps) {
  const session = controller.bootstrap?.session;
  const details = useProductAccountDetailsV1();
  const product = useProductEntitlementSnapshotV1();
  if (!session || session.status !== "authenticated") return null;

  return (
    <section className="account-center" aria-labelledby="account-center-title">
      <AccountCenterHeader
        controller={controller}
        showLegacyConfiguration={showLegacyConfiguration}
        product={product}
        refreshing={details.refreshing}
        lastUpdatedAt={details.lastUpdatedAt}
        onRefresh={() => details.refreshAll()}
      />
      <ProductAccountDetails details={details} product={product} />
    </section>
  );
}
