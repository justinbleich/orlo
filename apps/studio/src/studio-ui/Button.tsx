import { cn } from "./cn";

const baseButton =
  "inline-flex h-7 shrink-0 items-center justify-center gap-xs rounded-sm border px-sm text-sm " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line " +
  "disabled:cursor-not-allowed disabled:opacity-40";

export function Button({
  variant = "secondary",
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "secondary" | "primary" | "ghost";
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        baseButton,
        variant === "primary" &&
          "border-accent bg-accent text-chrome hover:bg-accent/90",
        variant === "secondary" &&
          "border-line bg-chrome-2 text-ink hover:bg-raised",
        variant === "ghost" &&
          "border-transparent bg-transparent text-ink-dim hover:bg-raised hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function StatusPill({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "accent" | "amber";
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 max-w-56 items-center rounded-sm border px-sm text-xs",
        "whitespace-nowrap",
        tone === "neutral" && "border-line bg-chrome-2 text-ink-faint",
        tone === "accent" && "border-accent-line bg-accent-soft text-accent",
        tone === "amber" && "border-amber/40 bg-amber/10 text-amber",
      )}
    >
      <span className="min-w-0 overflow-hidden text-ellipsis">{children}</span>
    </span>
  );
}
