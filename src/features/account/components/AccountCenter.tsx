import { Tabs, TabsList, TabsPanel, TabsTab } from "../../../components/ui/tabs";
import { EngineIcon } from "../../engine/components/EngineIcon";
import type { AccountExperienceControllerV1 } from "../hooks/useAccountExperienceController";
import { useAccountExperienceCopyV1 } from "../hooks/useAccountExperienceCopy";
import { requestAccountEngineSwitchV1 } from "../runtime/engineSwitchSignal";
import { AccountCenterHeader } from "./AccountCenterHeader";
import { AccountSecurityPanel } from "./AccountSecurityPanel";
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

  return (
    <section className="account-center" aria-labelledby="account-center-title">
      <AccountCenterHeader controller={controller} />
      <Tabs value={controller.centerTab} onValueChange={(value) => {
        if (value === "usage") controller.openUsage();
        if (value === "overview" || value === "security") controller.setCenterTab(value);
      }}>
        <TabsList className="account-center-tabs" aria-label={copy.accountCenter}>
          <TabsTab value="overview" onClick={() => controller.setCenterTab("overview")}>
            {copy.overview}
          </TabsTab>
          <TabsTab value="usage" onClick={controller.openUsage}>{copy.usage}</TabsTab>
          <TabsTab value="security" onClick={() => controller.setCenterTab("security")}>
            {copy.security}
          </TabsTab>
        </TabsList>
        <TabsPanel value="overview">
          <div className="account-overview-list">
            <div className="account-overview-row">
              <span>{copy.profile}</span>
              <strong>{controller.profile?.profile.displayName ?? session.profileLabel}</strong>
            </div>
            {!showLegacyConfiguration ? (
              <button
                type="button"
                className="account-overview-action"
                onClick={() => requestAccountEngineSwitchV1({
                  source: "accountCenter",
                  targetEngineId: null,
                  openNewConversation: true,
                })}
              >
                <span>{copy.gateMyEngines}</span>
                <strong>{copy.gateManageEngines}</strong>
              </button>
            ) : null}
            {showLegacyConfiguration ? (
              <button
                type="button"
                className="account-overview-action"
                aria-label={copy.configureCodexAction}
                onClick={controller.reopenConfiguration}
              >
                <span className="account-overview-product">
                  <EngineIcon engine="codex" size={18} />
                  <strong>Codex</strong>
                </span>
                <span className="account-overview-action-label">{copy.configureCodexAction}</span>
              </button>
            ) : null}
          </div>
        </TabsPanel>
        <TabsPanel value="usage"><AccountUsagePanel controller={controller} /></TabsPanel>
        <TabsPanel value="security">
          <AccountSecurityPanel
            controller={controller}
            showLegacyConfiguration={showLegacyConfiguration}
          />
        </TabsPanel>
      </Tabs>
    </section>
  );
}
