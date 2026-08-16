import { useAccountGatewayV1 } from "../gateway/AccountGatewayProvider";

export function useAccountGatewayContract() {
  return useAccountGatewayV1().contract;
}
