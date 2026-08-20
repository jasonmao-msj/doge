import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "../../../components/ui/tabs";
import type { AccountExperienceControllerV1 } from "../hooks/useAccountExperienceController";
import { useAccountExperienceCopyV1 } from "../hooks/useAccountExperienceCopy";
import { AccountCenterHeader } from "./AccountCenterHeader";
import { AccountSubscriptionPanel } from "./AccountSubscriptionPanel";
import { AccountUsagePanel } from "./AccountUsagePanel";

export type AccountCenterProps = {
  readonly controller: AccountExperienceControllerV1;
  readonly showLegacyConfiguration: boolean;
};

export function AccountCenter({
  controller,
  showLegacyConfiguration,
}: AccountCenterProps) {
  const copy = useAccountExperienceCopyV1();
  const session = controller.bootstrap?.session;
  if (!session || session.status !== "authenticated") return null;
  const subscriptionEnabled =
    controller.bootstrap?.capabilities.entries["subscription.summary"]?.status ===
    "enabled";

  return (
    <section className="account-center" aria-labelledby="account-center-title">
      <AccountCenterHeader
        controller={controller}
        showLegacyConfiguration={showLegacyConfiguration}
      />
      <Tabs
        value={controller.centerTab}
        onValueChange={(value) => {
          if (value === "usage") controller.openUsage();
          if (value === "subscription") controller.setCenterTab(value);
        }}
      >
        <TabsList
          className="account-center-tabs"
          aria-label={copy.accountCenter}
        >
          <TabsTab
            value="subscription"
            onClick={() => controller.setCenterTab("subscription")}
          >
            {copy.subscription}
          </TabsTab>
          <TabsTab value="usage" onClick={controller.openUsage}>
            {copy.usage}
          </TabsTab>
        </TabsList>
        <TabsPanel value="subscription">
          <AccountSubscriptionPanel enabled={subscriptionEnabled} />
        </TabsPanel>
        <TabsPanel value="usage">
          <AccountUsagePanel controller={controller} />
        </TabsPanel>
      </Tabs>
    </section>
  );
}
