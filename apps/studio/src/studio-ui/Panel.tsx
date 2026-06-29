import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";

export function PanelSection({
  title,
  subtitle,
  count,
  action,
  collapsible = true,
  defaultOpen = true,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  count?: React.ReactNode;
  action?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const header = (
    <div className="flex min-w-0 flex-1 items-start gap-xs">
      {collapsible && (
        <ChevronDown
          size={13}
          strokeWidth={2.25}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-ink-faint transition-transform group-data-[panel-open]:rotate-0 -rotate-90"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="eyebrow truncate text-ink">{title}</div>
        {subtitle && <div className="truncate text-xs text-ink-faint">{subtitle}</div>}
      </div>
    </div>
  );
  const countNode = count !== undefined && count !== null ? <PanelPill>{count}</PanelPill> : null;

  if (!collapsible) {
    return (
      <section className={cn("flex flex-col gap-xs", className)}>
        <div className="flex min-h-7 items-start gap-xs">
          {header}
          {countNode}
          {action}
        </div>
        {children}
      </section>
    );
  }

  return (
    <Collapsible.Root defaultOpen={defaultOpen} className={cn("flex flex-col gap-xs", className)}>
      <div className="flex min-h-7 items-start gap-xs">
        <Collapsible.Trigger
          className={cn(
            "group flex min-w-0 flex-1 text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line",
          )}
        >
          {header}
        </Collapsible.Trigger>
        {countNode}
        {action}
      </div>
      <Collapsible.Panel className="overflow-hidden data-[ending-style]:h-0 data-[starting-style]:h-0">
        <div className="flex flex-col gap-xs">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function PanelAction({
  title,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      {...props}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-sm border border-line bg-raised",
        "text-ink-dim transition-colors hover:bg-chrome-2 hover:text-ink",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PanelRow({
  icon: Icon,
  active,
  dim,
  action,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  active?: boolean;
  dim?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="group flex min-w-0 items-center gap-xs">
      <button
        type="button"
        {...props}
        className={cn(
          "flex h-7 min-w-0 flex-1 items-center gap-xs rounded-sm px-sm text-left text-sm",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line",
          active
            ? "bg-accent-soft text-accent"
            : dim
              ? "text-ink-faint hover:bg-raised hover:text-ink"
              : "text-ink-dim hover:bg-raised hover:text-ink",
          className,
        )}
      >
        {Icon && <Icon size={13} aria-hidden="true" className="shrink-0" />}
        {children}
      </button>
      {action}
    </div>
  );
}

export function PanelStaticRow({
  icon: Icon,
  dim,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  icon?: LucideIcon;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      {...props}
      className={cn(
        "flex h-7 min-w-0 items-center gap-xs rounded-sm px-sm text-sm",
        dim ? "text-ink-faint" : "text-ink-dim",
        className,
      )}
    >
      {Icon && <Icon size={13} aria-hidden="true" className="shrink-0" />}
      {children}
    </div>
  );
}

export function PanelPill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "amber";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-4 max-w-24 shrink-0 items-center rounded-xs px-xs text-2xs font-semibold",
        tone === "neutral" && "bg-raised text-ink-faint",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "amber" && "bg-amber/10 text-amber",
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
