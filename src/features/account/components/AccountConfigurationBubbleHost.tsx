import { useState } from "react";
import X from "lucide-react/dist/esm/icons/x";
import { DOGE_MASCOT_AVATAR_SRC } from "../../brand/runtime/productIcon";
import { useAccountExperienceCopyV1 } from "../hooks/useAccountExperienceCopy";
import {
  requestAccountConfigurationReopenV1,
  setAccountConfigurationBubbleVisibleV1,
  useAccountConfigurationBubbleVisibleV1,
} from "../runtime/configurationBubbleStore";
import "./account-configuration-bubble.css";

export type AccountConfigurationBubbleHostProps = {
  readonly onOpenAccount: () => void;
  readonly onHardDismiss?: () => Promise<boolean>;
};

export function AccountConfigurationBubbleHost({
  onOpenAccount,
  onHardDismiss,
}: AccountConfigurationBubbleHostProps) {
  const copy = useAccountExperienceCopyV1();
  const visible = useAccountConfigurationBubbleVisibleV1();
  const [dismissing, setDismissing] = useState(false);

  if (!visible) return null;

  const hardDismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    try {
      const dismissed = onHardDismiss ? await onHardDismiss() : await dismissRealOfferV1();
      if (dismissed) setAccountConfigurationBubbleVisibleV1(false);
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div className="account-config-bubble-wrap">
      <button
        type="button"
        className="account-config-bubble-dismiss"
        onClick={() => void hardDismiss()}
        aria-label={copy.dismissConfiguration}
        disabled={dismissing}
      >
        <X aria-hidden />
      </button>
      <button
        type="button"
        className="account-config-bubble"
        onClick={() => {
          requestAccountConfigurationReopenV1();
          onOpenAccount();
        }}
        aria-label={copy.reopenConfiguration}
      >
        <img src={DOGE_MASCOT_AVATAR_SRC} alt="" width={58} height={58} />
      </button>
    </div>
  );
}

async function dismissRealOfferV1(): Promise<boolean> {
  const [{ createRealAccountGatewayV1 }, { createAccountCallContextV1 }] = await Promise.all([
    import("../../../services/accountGateway"),
    import("../utils/accountFormValues"),
  ]);
  const result = await createRealAccountGatewayV1().configuration.hardDismiss(
    { recipeId: "doge.account.codex-token-service", recipeVersion: 1 },
    createAccountCallContextV1(),
  );
  return result.ok;
}
