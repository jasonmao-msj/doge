import CircleHelp from "lucide-react/dist/esm/icons/circle-help";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";

// Account Gate is a full-window overlay at z-index 10000. Tooltip content is
// portalled to body, so it must explicitly clear that overlay stacking level.
const ACCOUNT_HELP_TOOLTIP_Z_INDEX = 10_020;

export type AccountHelpTooltipProps = {
  readonly label: string;
  readonly children: string;
  readonly side?: "top" | "right" | "bottom" | "left";
  readonly expanded?: boolean;
  readonly controls?: string;
  readonly onTriggerClick?: () => void;
};

/**
 * Keeps secondary Account guidance out of the primary reading path while
 * remaining available to pointer and keyboard users.
 */
export function AccountHelpTooltip({
  label,
  children,
  side = "top",
  expanded,
  controls,
  onTriggerClick,
}: AccountHelpTooltipProps) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="account-help-trigger"
          aria-label={label}
          aria-expanded={expanded}
          aria-controls={controls}
          onClick={onTriggerClick}
        >
          <CircleHelp aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent
        className="account-help-tooltip"
        side={side}
        sideOffset={8}
        collisionPadding={12}
        style={{ zIndex: ACCOUNT_HELP_TOOLTIP_Z_INDEX }}
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
