import CircleHelp from "lucide-react/dist/esm/icons/circle-help";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";

export type AccountHelpTooltipProps = {
  readonly label: string;
  readonly children: string;
  readonly side?: "top" | "right" | "bottom" | "left";
};

/**
 * Keeps secondary Account guidance out of the primary reading path while
 * remaining available to pointer and keyboard users.
 */
export function AccountHelpTooltip({
  label,
  children,
  side = "top",
}: AccountHelpTooltipProps) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button type="button" className="account-help-trigger" aria-label={label}>
          <CircleHelp aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent
        className="account-help-tooltip"
        side={side}
        sideOffset={8}
        collisionPadding={12}
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
