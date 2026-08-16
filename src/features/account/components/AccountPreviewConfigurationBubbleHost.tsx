import { AccountConfigurationBubbleHost } from "./AccountConfigurationBubbleHost";
import { getProductPreviewAccountGatewayV1 } from "../mock/createProductPreviewAccountGatewayV1";
import { createAccountCallContextV1 } from "../utils/accountFormValues";

export type AccountPreviewConfigurationBubbleHostProps = {
  readonly onOpenAccount: () => void;
};

export function AccountPreviewConfigurationBubbleHost({
  onOpenAccount,
}: AccountPreviewConfigurationBubbleHostProps) {
  return (
    <AccountConfigurationBubbleHost
      onOpenAccount={onOpenAccount}
      onHardDismiss={async () => {
        const result = await getProductPreviewAccountGatewayV1().configuration.hardDismiss(
          { recipeId: "doge.account.codex-token-service", recipeVersion: 1 },
          createAccountCallContextV1(),
        );
        return result.ok;
      }}
    />
  );
}
