import { ChevronDown } from "lucide-react";
import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "./cn";

/**
 * A collapsible inspector section. Header uses the `.eyebrow` "pro tool" register
 * (STUDIO-UI.md discipline #4); body holds property rows. Optional `action` slot
 * sits at the right of the header (e.g. a reset button).
 *
 * Chrome only — Tailwind utilities here resolve to design tokens.
 */
export function Section({
  title,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Collapsible.Root
      defaultOpen={defaultOpen}
      className="border-b border-line-soft last:border-b-0"
    >
      <div className="flex items-center justify-between pr-md">
        <Collapsible.Trigger
          className={cn(
            "group flex flex-1 items-center gap-xs py-sm pl-md",
            "text-left text-ink-faint transition-colors hover:text-ink-dim",
            "focus-visible:outline-none",
          )}
        >
          <ChevronDown
            size={12}
            strokeWidth={2.5}
            aria-hidden="true"
            className="text-ink-faint transition-transform duration-150 group-data-[panel-open]:rotate-0 -rotate-90"
          />
          <span className="eyebrow">{title}</span>
        </Collapsible.Trigger>
        {action}
      </div>
      <Collapsible.Panel
        className={cn(
          "overflow-hidden",
          "data-[starting-style]:h-0 data-[ending-style]:h-0",
        )}
      >
        <div className="flex flex-col gap-sm px-md pb-md pt-xs">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
