/** Shared chrome for text-like inputs across the studio-ui layer. Keeps every
 *  control (number, text, color, select) visually identical. Tokens only. */
export const controlClass = [
  "h-7 w-full min-w-0 rounded-sm border border-line bg-chrome-2 px-sm",
  "text-sm text-ink tabular-nums",
  "transition-colors",
  "hover:border-line/0 hover:bg-raised",
  "focus-visible:outline-none focus-visible:border-accent-line focus-visible:bg-raised",
  "disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-chrome-2",
].join(" ");
