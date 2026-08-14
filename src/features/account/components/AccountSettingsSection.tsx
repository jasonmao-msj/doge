import type { AccountGatewayV1 } from "../contracts";
import { AccountGatewayProvider } from "../gateway/AccountGatewayProvider";
import { AccountExperience } from "./AccountExperience";

export type AccountSettingsSectionProps = {
  readonly gateway: AccountGatewayV1;
};

export function AccountSettingsSection({ gateway }: AccountSettingsSectionProps) {
  return (
    <AccountGatewayProvider gateway={gateway}>
      <AccountExperience />
    </AccountGatewayProvider>
  );
}
