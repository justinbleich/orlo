import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cn } from "./cn";

/**
 * Keyboard hint chip. Renders inside tooltips (and anywhere a shortcut should be
 * shown) so the studio surfaces its single-key tools the way pro design tools do.
 */
export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-xs border border-line",
        "bg-chrome-2 px-1 font-mono text-2xs font-medium leading-none text-ink-dim",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * Groups tooltip timing so the first hover waits, then sibling tooltips open
 * instantly while the pointer stays within the group (rail, toolbar, etc.).
 */
export function TooltipProvider({
  children,
  delay = 350,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return <BaseTooltip.Provider delay={delay}>{children}</BaseTooltip.Provider>;
}

/**
 * A chrome tooltip with an optional keyboard hint. Wrap a single interactive
 * element (native button or any element that forwards props/ref) as the trigger.
 *
 *   <Tooltip label="Select" kbd="V" side="top"><button …/></Tooltip>
 */
export function Tooltip({
  children,
  label,
  kbd,
  side = "top",
  sideOffset = 8,
}: {
  children: React.ReactElement;
  label: string;
  kbd?: string;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={sideOffset} className="z-50">
          <BaseTooltip.Popup
            className={cn(
              "studio-popup flex items-center gap-xs rounded-sm border border-line bg-chrome",
              "px-sm py-2xs text-2xs text-ink shadow-popover",
              "origin-[var(--transform-origin)] transition-[opacity,transform] duration-100",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            )}
          >
            <span>{label}</span>
            {kbd ? <Kbd>{kbd}</Kbd> : null}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
