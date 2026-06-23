/** Tiny classname joiner — drops falsy values, joins with spaces. Keeps the
 *  studio-ui layer dependency-free (no clsx) while staying readable. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
