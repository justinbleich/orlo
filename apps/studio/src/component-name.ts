const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

export function toComponentFileName(name: string): string {
  const pascal = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return IDENT_RE.test(pascal) ? pascal : "Screen";
}
