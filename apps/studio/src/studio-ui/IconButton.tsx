import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

const base =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-sm border text-ink-dim " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line " +
  "disabled:cursor-not-allowed disabled:opacity-40";

/** A square icon button on the chrome control chrome. The `title` doubles as the
 *  tooltip label; pass `kbd` to surface a keyboard shortcut hint. */
export function IconButton({
  title,
  kbd,
  tooltipSide = "bottom",
  onClick,
  disabled,
  children,
}: {
  title: string;
  kbd?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={title} kbd={kbd} side={tooltipSide}>
      <button
        type="button"
        aria-label={title}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          base,
          "border-line bg-chrome-2 hover:bg-raised hover:text-ink",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** A toggleable icon button (e.g. lock / hide). Pressed state uses the accent. */
export function IconToggle({
  title,
  pressed,
  onPressedChange,
  disabled,
  children,
}: {
  title: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <BaseToggle
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={disabled}
      aria-label={title}
      title={title}
      className={cn(
        base,
        pressed
          ? "border-accent-line bg-accent-soft text-accent"
          : "border-line bg-chrome-2 hover:bg-raised hover:text-ink",
      )}
    >
      {children}
    </BaseToggle>
  );
}
