/**
 * The model boundary. Every style that enters the document is validated here;
 * web-only CSS is rejected (PRD §7.4, BUILD invariant 1). Pure, no DOM, so it
 * runs identically in the studio, in codegen, and in tests.
 */
import type { RNStyle, StyleKey, TransformOp } from "./types";
import {
  ALL_STYLE_KEYS,
  COLOR_KEYS,
  DIMENSION_KEYS,
  ENUM_VALUES,
  NUMBER_KEYS,
} from "./keys";

export interface StyleError {
  key: string;
  value: unknown;
  reason: string;
}

export type StyleValidation =
  | { ok: true; style: RNStyle }
  | { ok: false; errors: StyleError[] };

const UNIT_RE = /(px|rem|em|vh|vw|vmin|vmax|pt|pc|cm|mm|in|ch|ex)\s*$/i;
const PERCENT_RE = /^-?\d+(\.\d+)?%$/;

/** Hints for the most common web-only properties people reach for. */
const WEB_ONLY_HINTS: Record<string, string> = {
  display: "RN has no `display: grid/block`; use flexbox props instead",
  boxShadow: "use shadowColor/shadowOffset/shadowOpacity/shadowRadius (+ elevation) instead",
  gridTemplateColumns: "CSS grid is not supported in RN; use flexbox",
  gridTemplateRows: "CSS grid is not supported in RN; use flexbox",
  cursor: "not an RN style",
  transition: "animation is post-v1; not an RN style",
  background: "use backgroundColor (no shorthand/gradients in v1)",
  float: "not supported in RN",
  inset: "use top/right/bottom/left individually",
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isDimension(v: unknown): boolean {
  if (isFiniteNumber(v)) return true;
  if (v === "auto") return true;
  if (typeof v === "string") return PERCENT_RE.test(v);
  return false;
}

function dimensionReason(v: unknown): string {
  if (typeof v === "string" && UNIT_RE.test(v)) {
    return "unit strings are not allowed; use a unitless number (dp), a \"%\" string, or \"auto\"";
  }
  if (typeof v === "string" && /\s/.test(v.trim())) {
    return "shorthand strings are not allowed; set each side individually";
  }
  return "expected a number (dp), a \"%\" string, or \"auto\"";
}

function isValidTransform(v: unknown): v is TransformOp[] {
  if (!Array.isArray(v)) return false;
  return v.every((op) => {
    if (typeof op !== "object" || op === null) return false;
    const entries = Object.entries(op);
    if (entries.length !== 1) return false;
    const [k, val] = entries[0];
    switch (k) {
      case "translateX":
      case "translateY":
      case "scale":
      case "scaleX":
      case "scaleY":
        return isFiniteNumber(val);
      case "rotate":
      case "skewX":
      case "skewY":
        return typeof val === "string" && /^-?\d+(\.\d+)?deg$/.test(val);
      default:
        return false;
    }
  });
}

function validateValue(key: StyleKey, value: unknown): string | null {
  if (value === undefined) return null;

  if (DIMENSION_KEYS.has(key)) {
    return isDimension(value) ? null : dimensionReason(value);
  }
  if (NUMBER_KEYS.has(key)) {
    return isFiniteNumber(value) ? null : "expected a finite number";
  }
  if (COLOR_KEYS.has(key)) {
    return typeof value === "string" ? null : "expected a color string";
  }
  const enumSet = ENUM_VALUES[key];
  if (enumSet) {
    return enumSet.has(value as string)
      ? null
      : `expected one of: ${[...enumSet].join(", ")}`;
  }
  if (key === "fontFamily") {
    return typeof value === "string" ? null : "expected a font family string";
  }
  if (key === "shadowOffset") {
    const ok =
      typeof value === "object" &&
      value !== null &&
      isFiniteNumber((value as Record<string, unknown>).width) &&
      isFiniteNumber((value as Record<string, unknown>).height);
    return ok ? null : "expected { width: number, height: number }";
  }
  if (key === "transform") {
    return isValidTransform(value)
      ? null
      : "expected an array of single-key transform ops (translateX/Y, scale[X/Y], rotate/skewX/Y in deg)";
  }
  return "unsupported style property";
}

/**
 * Validate an unknown value against the RN style subset. Pure; returns either
 * the typed style or a list of per-key errors. Callers that want fail-closed
 * behavior should use `assertStyle`.
 */
export function validateStyle(input: unknown): StyleValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ key: "(root)", value: input, reason: "expected a style object" }],
    };
  }

  const errors: StyleError[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (!ALL_STYLE_KEYS.has(key as StyleKey)) {
      const hint = WEB_ONLY_HINTS[key];
      errors.push({
        key,
        value,
        reason: hint ? `not an RN style property — ${hint}` : "unknown style property",
      });
      continue;
    }
    const reason = validateValue(key as StyleKey, value);
    if (reason) errors.push({ key, value, reason });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, style: input as RNStyle };
}

/** Fail-closed variant for write boundaries (tree ops). Throws on invalid input. */
export function assertStyle(input: unknown): RNStyle {
  const result = validateStyle(input);
  if (!result.ok) {
    const detail = result.errors
      .map((e) => `${e.key}: ${e.reason} (got ${JSON.stringify(e.value)})`)
      .join("; ");
    throw new Error(`Invalid RNStyle — ${detail}`);
  }
  return result.style;
}
