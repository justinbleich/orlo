const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

export function toPascalName(input: string): string {
  return input
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function toComponentFileName(name: string): string {
  const pascal = toPascalName(name);
  return IDENT_RE.test(pascal) ? pascal : "Screen";
}

export function toComponentDisplayPath(input: string, fallback = "Component"): string {
  const raw = input.trim() || fallback;
  const segments = raw
    .split(".")
    .map((part) => {
      const pascal = toPascalName(part);
      return /^[A-Z]/.test(pascal) ? pascal : pascal ? `C${pascal}` : "";
    })
    .filter(Boolean);
  return segments.length > 0 ? segments.join(".") : toPascalName(fallback) || "Component";
}
