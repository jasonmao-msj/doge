import { useAccountGatewayContract } from "../hooks/useAccountGatewayContract";

export type AccountGatewayConsumerShellProps = {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly contractLabel: string;
};

export function AccountGatewayConsumerShell({
  eyebrow,
  title,
  description,
  contractLabel,
}: AccountGatewayConsumerShellProps) {
  const contract = useAccountGatewayContract();
  return (
    <section className="account-lab-consumer" aria-labelledby="account-lab-consumer-title">
      <div>
        <p className="account-lab-eyebrow">{eyebrow}</p>
        <h2 id="account-lab-consumer-title">{title}</h2>
        <p>{description}</p>
      </div>
      <output className="account-lab-contract" aria-label={contractLabel}>
        {contract.id}@{contract.version}
      </output>
    </section>
  );
}
