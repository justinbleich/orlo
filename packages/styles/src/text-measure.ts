/**
 * Text measurement — deliberately separate from the style→Yoga mapping.
 *
 * Text is the largest expected source of canvas/device divergence (PRD §9 #1).
 * Isolating it means we can swap measurement strategies (canvas-2d now; pinned
 * font-metric tables later for determinism, PRD §8) without touching layout.
 *
 * The returned measurer is injected into the renderer, which wires it to each
 * Text node's Yoga measure function.
 */
import type { RNStyle } from "./types";

export interface TextMeasureInput {
  text: string;
  style: RNStyle;
  numberOfLines?: number;
  /** Available width from Yoga, used for wrapping. Unbounded if undefined. */
  maxWidth?: number;
}

export interface TextMeasureResult {
  width: number;
  height: number;
}

export interface TextMeasurer {
  measure(input: TextMeasureInput): TextMeasureResult;
}

/** Pinnable per-family metrics for deterministic line height (PRD §8). */
export type FontMetricsTable = Record<
  string,
  { ascent: number; descent: number; lineGap: number }
>;

const DEFAULT_FONT_SIZE = 14;
/** RN's default line-height multiple when none is set, used as a fallback. */
const DEFAULT_LINE_HEIGHT_RATIO = 1.25;

function fontShorthand(style: RNStyle): string {
  const size = style.fontSize ?? DEFAULT_FONT_SIZE;
  const weight = style.fontWeight ?? "400";
  const fontStyle = style.fontStyle ?? "normal";
  const family = style.fontFamily ?? "system-ui, -apple-system, sans-serif";
  return `${fontStyle} ${weight} ${size}px ${family}`;
}

function lineHeightPx(style: RNStyle, metrics?: FontMetricsTable): number {
  if (typeof style.lineHeight === "number") return style.lineHeight;
  const size = style.fontSize ?? DEFAULT_FONT_SIZE;
  const family = style.fontFamily;
  if (family && metrics?.[family]) {
    const m = metrics[family];
    return Math.ceil(size * (m.ascent + m.descent + m.lineGap));
  }
  return Math.ceil(size * DEFAULT_LINE_HEIGHT_RATIO);
}

/**
 * Greedy word-wrap to count lines and the widest line, given a per-string
 * width function. Shared by the canvas and fallback measurers.
 */
function wrap(
  text: string,
  widthOf: (s: string) => number,
  maxWidth: number | undefined,
  maxLines: number | undefined,
): { lines: number; width: number } {
  const hardLines = text.split("\n");
  let totalLines = 0;
  let widest = 0;

  for (const hardLine of hardLines) {
    if (maxWidth === undefined || maxWidth === Infinity) {
      const w = widthOf(hardLine);
      widest = Math.max(widest, w);
      totalLines += 1;
      continue;
    }
    const words = hardLine.split(/(\s+)/).filter((w) => w.length > 0);
    let current = "";
    let linesHere = 0;
    const flush = () => {
      widest = Math.max(widest, widthOf(current));
      current = "";
      linesHere += 1;
    };
    for (const word of words) {
      const candidate = current + word;
      if (widthOf(candidate) <= maxWidth || current === "") {
        current = candidate;
      } else {
        flush();
        current = word.trimStart();
      }
    }
    if (current !== "" || linesHere === 0) flush();
    totalLines += linesHere;
  }

  if (maxLines && maxLines > 0) totalLines = Math.min(totalLines, maxLines);
  return { lines: Math.max(1, totalLines), width: Math.ceil(widest) };
}

/**
 * Browser canvas-2d measurer. Falls back to a deterministic character-width
 * estimate when no DOM is present (Node/tests), so the same code path is usable
 * everywhere.
 */
export function createCanvasTextMeasurer(opts?: {
  fontMetrics?: FontMetricsTable;
}): TextMeasurer {
  const metrics = opts?.fontMetrics;

  let ctx: CanvasRenderingContext2D | null = null;
  if (typeof document !== "undefined") {
    ctx = document.createElement("canvas").getContext("2d");
  }

  return {
    measure({ text, style, numberOfLines, maxWidth }): TextMeasureResult {
      const lh = lineHeightPx(style, metrics);
      const letterSpacing = style.letterSpacing ?? 0;

      const widthOf = (s: string): number => {
        if (ctx) {
          ctx.font = fontShorthand(style);
          return ctx.measureText(s).width + letterSpacing * Math.max(0, s.length - 1);
        }
        const size = style.fontSize ?? DEFAULT_FONT_SIZE;
        return s.length * (size * 0.6 + letterSpacing);
      };

      const { lines, width } = wrap(text, widthOf, maxWidth, numberOfLines);
      return { width, height: lines * lh };
    },
  };
}
