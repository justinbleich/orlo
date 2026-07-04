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

/** The v1 canvas/harness font. Keep this aligned with both app font loaders. */
export const DEFAULT_FONT_FAMILY = "Inter";

/**
 * Normalized OpenType hhea metrics from Inter 400 v4.1
 * (@expo-google-fonts/inter 0.4.2): 1984 / -494 / 0 at 2048 units/em.
 */
export const DEFAULT_FONT_METRICS: FontMetricsTable = Object.freeze({
  [DEFAULT_FONT_FAMILY]: Object.freeze({
    ascent: 1984 / 2048,
    descent: 494 / 2048,
    lineGap: 0,
  }),
});

const DEFAULT_FONT_SIZE = 14;
/** RN's default line-height multiple when none is set, used as a fallback. */
const DEFAULT_LINE_HEIGHT_RATIO = 1.25;

function fontShorthand(style: RNStyle): string {
  const size = style.fontSize ?? DEFAULT_FONT_SIZE;
  const weight = style.fontWeight ?? "400";
  const fontStyle = style.fontStyle ?? "normal";
  const family = style.fontFamily ?? DEFAULT_FONT_FAMILY;
  return `${fontStyle} ${weight} ${size}px ${family}`;
}

function lineHeightPx(style: RNStyle, metrics?: FontMetricsTable): number {
  if (typeof style.lineHeight === "number") return style.lineHeight;
  const size = style.fontSize ?? DEFAULT_FONT_SIZE;
  const family = style.fontFamily ?? DEFAULT_FONT_FAMILY;
  if (metrics?.[family]) {
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

/** Bounded insert-order cache: cleared wholesale when full (strings are tiny,
 *  rebuilding is cheap, and no LRU bookkeeping stays off the measure hot path). */
class BoundedCache<V> {
  private map = new Map<string, V>();
  constructor(private readonly limit: number) {}
  get(key: string): V | undefined {
    return this.map.get(key);
  }
  set(key: string, value: V): void {
    if (this.map.size >= this.limit) this.map.clear();
    this.map.set(key, value);
  }
}

/**
 * Browser canvas-2d measurer. Falls back to a deterministic character-width
 * estimate when no DOM is present (Node/tests), so the same code path is usable
 * everywhere.
 *
 * Measurement is memoized at two levels — per-string widths (hit hardest: wrap()
 * probes a width per word candidate on every Yoga pass) and full measure results.
 * Yoga rebuilds the whole tree per layout, so without this every keystroke and
 * drag re-measured every Text node from scratch.
 */
export function createCanvasTextMeasurer(opts?: {
  fontMetrics?: FontMetricsTable;
}): TextMeasurer {
  const metrics = opts?.fontMetrics ?? DEFAULT_FONT_METRICS;

  let ctx: CanvasRenderingContext2D | null = null;
  if (typeof document !== "undefined") {
    ctx = document.createElement("canvas").getContext("2d");
  }

  const widthCache = new BoundedCache<number>(8_000);
  const resultCache = new BoundedCache<TextMeasureResult>(4_000);

  return {
    measure({ text, style, numberOfLines, maxWidth }): TextMeasureResult {
      const lh = lineHeightPx(style, metrics);
      const letterSpacing = style.letterSpacing ?? 0;
      const font = fontShorthand(style);

      // Round the wrap width slightly so sub-pixel jitter from Yoga doesn't
      // defeat the result cache (a 0.1px width change can't alter wrapping in
      // any way a user can perceive).
      const widthKey = maxWidth === undefined ? "∞" : (Math.round(maxWidth * 10) / 10).toString();
      const resultKey = `${font}|${letterSpacing}|${lh}|${numberOfLines ?? ""}|${widthKey}|${text}`;
      const cached = resultCache.get(resultKey);
      if (cached) return cached;

      const widthOf = (s: string): number => {
        const key = `${font}|${letterSpacing}|${s}`;
        const hit = widthCache.get(key);
        if (hit !== undefined) return hit;
        let width: number;
        if (ctx) {
          ctx.font = font;
          width = ctx.measureText(s).width + letterSpacing * Math.max(0, s.length - 1);
        } else {
          const size = style.fontSize ?? DEFAULT_FONT_SIZE;
          width = s.length * (size * 0.6 + letterSpacing);
        }
        widthCache.set(key, width);
        return width;
      };

      const { lines, width } = wrap(text, widthOf, maxWidth, numberOfLines);
      const result = { width, height: lines * lh };
      resultCache.set(resultKey, result);
      return result;
    },
  };
}
