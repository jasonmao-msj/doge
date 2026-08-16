import { useMemo } from "react";
import { getProductPreviewAccountGatewayV1 } from "../mock/createProductPreviewAccountGatewayV1";
import { AccountSettingsSection } from "./AccountSettingsSection";

export function AccountPreviewSettingsSection() {
  const gateway = useMemo(getProductPreviewAccountGatewayV1, []);
  return <AccountSettingsSection gateway={gateway} />;
}
