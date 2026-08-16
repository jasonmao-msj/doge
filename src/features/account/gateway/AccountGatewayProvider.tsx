import {
  createContext,
  type ReactNode,
  useContext,
} from "react";
import type { AccountGatewayV1 } from "../contracts/gateway";

const AccountGatewayContext = createContext<AccountGatewayV1 | null>(null);

export type AccountGatewayProviderProps = {
  readonly gateway: AccountGatewayV1;
  readonly children: ReactNode;
};

export function AccountGatewayProvider({
  gateway,
  children,
}: AccountGatewayProviderProps) {
  return (
    <AccountGatewayContext.Provider value={gateway}>
      {children}
    </AccountGatewayContext.Provider>
  );
}

export function useAccountGatewayV1(): AccountGatewayV1 {
  const gateway = useContext(AccountGatewayContext);
  if (gateway === null) {
    throw new Error("AccountGatewayProvider is required");
  }
  return gateway;
}
