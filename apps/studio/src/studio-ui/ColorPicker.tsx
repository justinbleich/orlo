import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Pipette } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "./cn";
import type { EditLifecycle } from "./controls";
import { Select } from "./Select";

type Hsv = { h: number; s: number; v: number };
type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };
type ColorValue = Rgb & { a: number };
type ColorFormat = "hex" | "rgb" | "hsl";

const FORMAT_OPTIONS = [
  { value: "hex", label: "HEX" },
  { value: "rgb", label: "RGB" },
  { value: "hsl", label: "HSL" },
] satisfies Array<{ value: ColorFormat; label: string }>;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function clampChannel(value: number) {
  return Math.round(clamp(value, 0, 255));
}

function clampDegree(value: number) {
  return Math.round(clamp(value, 0, 360));
}

function clampPercent(value: number) {
  return Math.round(clamp(value, 0, 100));
}

function alphaToPercent(alpha: number) {
  return Math.round(clamp(alpha) * 100);
}

function percentToAlpha(percent: number) {
  return clamp(clampPercent(percent) / 100);
}

function alphaToHex(alpha: number) {
  return clampChannel(clamp(alpha) * 255).toString(16).padStart(2, "0");
}

function hexToAlpha(hex: string | undefined) {
  return hex ? Number.parseInt(hex, 16) / 255 : 1;
}

function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed);
  if (!match) return null;
  const raw = match[1];
  const hex =
    raw.length === 3 || raw.length === 4
      ? raw
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : raw;
  return `#${hex.toLowerCase()}`;
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((part) => clampChannel(part).toString(16).padStart(2, "0")).join("")}`;
}

function colorToHex(color: ColorValue, includeAlpha = color.a < 1) {
  return `${rgbToHex(color.r, color.g, color.b)}${includeAlpha ? alphaToHex(color.a) : ""}`;
}

function colorToCss(color: ColorValue) {
  const r = clampChannel(color.r);
  const g = clampChannel(color.g);
  const b = clampChannel(color.b);
  const a = clamp(color.a);
  if (a >= 0.995) return rgbToHex(r, g, b);
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

function parseHexColor(input: string): ColorValue | null {
  const normalized = normalizeHex(input);
  if (!normalized) return null;
  const body = normalized.slice(1);
  const int = Number.parseInt(body.slice(0, 6), 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
    a: hexToAlpha(body.slice(6, 8)),
  };
}

function parseFunctionalColor(input: string): ColorValue | null {
  const trimmed = input.trim();
  const rgbMatch = /^rgba?\((.+)\)$/i.exec(trimmed);
  if (rgbMatch) {
    const parts = rgbMatch[1]
      .replace(/\//g, ",")
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 3) return null;
    return {
      r: clampChannel(Number(parts[0])),
      g: clampChannel(Number(parts[1])),
      b: clampChannel(Number(parts[2])),
      a: parts[3] == null ? 1 : parseAlpha(parts[3]),
    };
  }

  const hslMatch = /^hsla?\((.+)\)$/i.exec(trimmed);
  if (hslMatch) {
    const parts = hslMatch[1]
      .replace(/\//g, ",")
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 3) return null;
    const hsl = {
      h: clampDegree(Number(parts[0])),
      s: clampPercent(Number(parts[1].replace("%", ""))),
      l: clampPercent(Number(parts[2].replace("%", ""))),
    };
    return { ...hslToRgb(hsl), a: parts[3] == null ? 1 : parseAlpha(parts[3]) };
  }

  return null;
}

function parseAlpha(value: string) {
  const numeric = Number(value.replace("%", ""));
  if (!Number.isFinite(numeric)) return 1;
  return value.includes("%") ? percentToAlpha(numeric) : clamp(numeric);
}

function parseColor(input: string | undefined): ColorValue {
  if (!input) return { r: 0, g: 0, b: 0, a: 1 };
  return parseHexColor(input) ?? parseFunctionalColor(input) ?? { r: 0, g: 0, b: 0, a: 1 };
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function hsvToColor(hsv: Hsv, alpha: number): ColorValue {
  return { ...hsvToRgb(hsv), a: alpha };
}

export function ColorPickerPopover({
  value,
  onChange,
  disabled,
  trigger,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  trigger: ReactNode;
} & EditLifecycle) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger render={trigger as never} disabled={disabled} />
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="z-50">
          <Popover.Popup className="studio-popup w-[320px] rounded-md border border-line-soft bg-chrome p-xs shadow-popover outline-none">
            <ColorPickerPanel
              value={value}
              onChange={onChange}
              onEditStart={onEditStart}
              onEditEnd={onEditEnd}
              onEditCancel={onEditCancel}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ColorPickerPanel({
  value,
  onChange,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
} & EditLifecycle) {
  const color = useMemo(() => parseColor(value), [value]);
  const hsv = useMemo(() => rgbToHsv(color.r, color.g, color.b), [color]);
  const hsl = useMemo(() => rgbToHsl(color.r, color.g, color.b), [color]);
  const [format, setFormat] = useState<ColorFormat>("hsl");
  const [hexDraft, setHexDraft] = useState(colorToHex(color));
  const draggingRef = useRef(false);
  const textEditingRef = useRef(false);

  useEffect(() => setHexDraft(colorToHex(color)), [color]);

  const commitColor = (next: ColorValue) => onChange(colorToCss(next));
  const startDrag = () => {
    if (!draggingRef.current) {
      draggingRef.current = true;
      onEditStart?.();
    }
  };
  const finishDrag = () => {
    if (draggingRef.current) {
      draggingRef.current = false;
      onEditEnd?.();
    }
  };
  const startTextEdit = () => {
    if (!textEditingRef.current) {
      textEditingRef.current = true;
      onEditStart?.();
    }
  };
  const finishTextEdit = () => {
    if (textEditingRef.current) {
      textEditingRef.current = false;
      onEditEnd?.();
    }
  };
  const cancelTextEdit = () => {
    if (textEditingRef.current) {
      textEditingRef.current = false;
      onEditCancel?.();
    }
  };

  return (
    <div className="flex flex-col gap-sm">
      <SaturationValueField
        hsv={hsv}
        color={color}
        onStart={startDrag}
        onChange={(next) => commitColor(hsvToColor(next, color.a))}
        onEnd={finishDrag}
      />
      <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-sm">
        <button
          type="button"
          disabled
          title="Eyedropper is not available yet"
          className="row-span-2 flex h-[72px] items-center justify-center rounded-sm border border-line-soft bg-chrome-2 text-ink-faint shadow-control disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Pipette size={22} aria-hidden="true" />
        </button>
        <HueSlider
          hsv={hsv}
          onStart={startDrag}
          onChange={(next) => commitColor(hsvToColor(next, color.a))}
          onEnd={finishDrag}
        />
        <AlphaSlider
          color={color}
          onStart={startDrag}
          onChange={(alpha) => commitColor({ ...color, a: alpha })}
          onEnd={finishDrag}
        />
      </div>
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-sm">
        <Select<ColorFormat> value={format} onChange={setFormat} options={FORMAT_OPTIONS} />
        {format === "hex" ? (
          <HexFields
            color={color}
            draft={hexDraft}
            onDraftChange={setHexDraft}
            onChange={commitColor}
            onEditStart={startTextEdit}
            onEditEnd={finishTextEdit}
            onEditCancel={cancelTextEdit}
          />
        ) : format === "rgb" ? (
          <RgbFields
            color={color}
            onChange={commitColor}
            onEditStart={startTextEdit}
            onEditEnd={finishTextEdit}
            onEditCancel={cancelTextEdit}
          />
        ) : (
          <HslFields
            hsl={hsl}
            alpha={color.a}
            onChange={(next, alpha = color.a) => commitColor({ ...hslToRgb(next), a: alpha })}
            onEditStart={startTextEdit}
            onEditEnd={finishTextEdit}
            onEditCancel={cancelTextEdit}
          />
        )}
      </div>
    </div>
  );
}

function SaturationValueField({
  hsv,
  color,
  onStart,
  onChange,
  onEnd,
}: {
  hsv: Hsv;
  color: ColorValue;
  onStart: () => void;
  onChange: (hsv: Hsv) => void;
  onEnd: () => void;
}) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const hueHex = colorToCss({ ...hsvToRgb({ h: hsv.h, s: 1, v: 1 }), a: 1 });
  const applyPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = clamp((event.clientX - rect.left) / rect.width);
    const v = 1 - clamp((event.clientY - rect.top) / rect.height);
    onChange({ ...hsv, s, v });
  };
  return (
    <div
      ref={fieldRef}
      role="slider"
      aria-label="Color saturation and brightness"
      aria-valuetext={colorToCss(color)}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onStart();
        applyPointer(event);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        applyPointer(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        onEnd();
      }}
      onPointerCancel={onEnd}
      className="relative h-[280px] cursor-crosshair overflow-hidden rounded-md outline-none ring-1 ring-inset ring-line-soft focus-visible:ring-2 focus-visible:ring-accent-line"
      style={{
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
      }}
    >
      <span
        className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-popover ring-1 ring-black/20"
        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

function HueSlider({
  hsv,
  onStart,
  onChange,
  onEnd,
}: {
  hsv: Hsv;
  onStart: () => void;
  onChange: (hsv: Hsv) => void;
  onEnd: () => void;
}) {
  const applyPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onChange({ ...hsv, h: clamp((event.clientX - rect.left) / rect.width) * 360 });
  };
  return (
    <SliderTrack
      ariaLabel="Color hue"
      ariaValue={Math.round(hsv.h)}
      onStart={onStart}
      onMove={applyPointer}
      onEnd={onEnd}
      background="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
    >
      <span
        className="absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-popover ring-1 ring-black/20"
        style={{ left: `${(hsv.h / 360) * 100}%`, background: colorToCss({ ...hsvToRgb({ h: hsv.h, s: 1, v: 1 }), a: 1 }) }}
        aria-hidden="true"
      />
    </SliderTrack>
  );
}

function AlphaSlider({
  color,
  onStart,
  onChange,
  onEnd,
}: {
  color: ColorValue;
  onStart: () => void;
  onChange: (alpha: number) => void;
  onEnd: () => void;
}) {
  const opaque = colorToCss({ ...color, a: 1 });
  const applyPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onChange(clamp((event.clientX - rect.left) / rect.width));
  };
  return (
    <SliderTrack
      ariaLabel="Color alpha"
      ariaValue={alphaToPercent(color.a)}
      onStart={onStart}
      onMove={applyPointer}
      onEnd={onEnd}
      className="color-checker"
      background={`linear-gradient(to right, transparent, ${opaque})`}
    >
      <span
        className="absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-popover ring-1 ring-black/20"
        style={{ left: `${color.a * 100}%`, background: colorToCss(color) }}
        aria-hidden="true"
      />
    </SliderTrack>
  );
}

function SliderTrack({
  ariaLabel,
  ariaValue,
  background,
  className,
  children,
  onStart,
  onMove,
  onEnd,
}: {
  ariaLabel: string;
  ariaValue: number;
  background: string;
  className?: string;
  children: ReactNode;
  onStart: () => void;
  onMove: (event: PointerEvent<HTMLDivElement>) => void;
  onEnd: () => void;
}) {
  return (
    <div
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={ariaLabel.includes("alpha") ? 100 : 360}
      aria-valuenow={ariaValue}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onStart();
        onMove(event);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onMove(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        onEnd();
      }}
      onPointerCancel={onEnd}
      className={cn(
        "relative h-6 cursor-ew-resize rounded-pill outline-none ring-1 ring-inset ring-line-soft focus-visible:ring-2 focus-visible:ring-accent-line",
        className,
      )}
    >
      <span className="absolute inset-0 rounded-pill" style={{ background }} aria-hidden="true" />
      {children}
    </div>
  );
}

function HexFields({
  color,
  draft,
  onDraftChange,
  onChange,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: {
  color: ColorValue;
  draft: string;
  onDraftChange: (value: string) => void;
  onChange: (value: ColorValue) => void;
} & Required<EditLifecycle>) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_72px] overflow-hidden rounded-sm border border-line-soft bg-chrome-2">
      <input
        value={draft}
        onFocus={onEditStart}
        onBlur={() => {
          const next = parseHexColor(draft);
          if (next) onChange(next);
          else onDraftChange(colorToHex(color));
          onEditEnd();
        }}
        onChange={(event) => {
          const nextDraft = event.target.value;
          onDraftChange(nextDraft);
          const next = parseHexColor(nextDraft);
          if (next) onChange(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") {
            onDraftChange(colorToHex(color));
            onEditCancel();
            (event.target as HTMLInputElement).blur();
          }
        }}
        spellCheck={false}
        className="h-9 min-w-0 border-0 bg-transparent px-sm font-mono text-xs uppercase tabular-nums text-ink outline-none"
      />
      <ColorNumberInput
        label="A"
        value={alphaToPercent(color.a)}
        max={100}
        suffix="%"
        flush
        onChange={(next) => onChange({ ...color, a: percentToAlpha(next) })}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
        onEditCancel={onEditCancel}
      />
    </div>
  );
}

function RgbFields({
  color,
  onChange,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: {
  color: ColorValue;
  onChange: (value: ColorValue) => void;
} & Required<EditLifecycle>) {
  return (
    <ColorNumberGrid>
      <ColorNumberInput label="R" value={color.r} max={255} onChange={(next) => onChange({ ...color, r: next })} onEditStart={onEditStart} onEditEnd={onEditEnd} onEditCancel={onEditCancel} />
      <ColorNumberInput label="G" value={color.g} max={255} onChange={(next) => onChange({ ...color, g: next })} onEditStart={onEditStart} onEditEnd={onEditEnd} onEditCancel={onEditCancel} />
      <ColorNumberInput label="B" value={color.b} max={255} onChange={(next) => onChange({ ...color, b: next })} onEditStart={onEditStart} onEditEnd={onEditEnd} onEditCancel={onEditCancel} />
      <ColorNumberInput label="A" value={alphaToPercent(color.a)} max={100} suffix="%" onChange={(next) => onChange({ ...color, a: percentToAlpha(next) })} onEditStart={onEditStart} onEditEnd={onEditEnd} onEditCancel={onEditCancel} />
    </ColorNumberGrid>
  );
}

function HslFields({
  hsl,
  alpha,
  onChange,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: {
  hsl: Hsl;
  alpha: number;
  onChange: (value: Hsl, alpha?: number) => void;
} & Required<EditLifecycle>) {
  return (
    <ColorNumberGrid>
      <ColorNumberInput label="H" value={hsl.h} max={360} onChange={(next) => onChange({ ...hsl, h: next })} onEditStart={onEditStart} onEditEnd={onEditEnd} onEditCancel={onEditCancel} />
      <ColorNumberInput label="S" value={hsl.s} max={100} suffix="%" onChange={(next) => onChange({ ...hsl, s: next })} onEditStart={onEditStart} onEditEnd={onEditEnd} onEditCancel={onEditCancel} />
      <ColorNumberInput label="L" value={hsl.l} max={100} suffix="%" onChange={(next) => onChange({ ...hsl, l: next })} onEditStart={onEditStart} onEditEnd={onEditEnd} onEditCancel={onEditCancel} />
      <ColorNumberInput label="A" value={alphaToPercent(alpha)} max={100} suffix="%" onChange={(next) => onChange(hsl, percentToAlpha(next))} onEditStart={onEditStart} onEditEnd={onEditEnd} onEditCancel={onEditCancel} />
    </ColorNumberGrid>
  );
}

function ColorNumberGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-4 overflow-hidden rounded-sm border border-line-soft bg-chrome-2">{children}</div>;
}

function ColorNumberInput({
  label,
  value,
  max,
  suffix,
  flush,
  onChange,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: {
  label: string;
  value: number;
  max: 100 | 255 | 360;
  suffix?: string;
  flush?: boolean;
  onChange: (value: number) => void;
} & Required<EditLifecycle>) {
  const displayValue = Math.round(value);
  return (
    <label className={cn("flex h-9 min-w-0 items-center bg-chrome-2 px-xs", !flush && "border-l border-line-soft first:border-l-0")}>
      <span className="mr-2xs text-2xs font-semibold uppercase text-ink-faint">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={displayValue}
        onFocus={onEditStart}
        onBlur={onEditEnd}
        onChange={(event) => {
          const raw = Number(event.target.value);
          if (!Number.isFinite(raw)) return;
          const next = max === 255 ? clampChannel(raw) : max === 360 ? clampDegree(raw) : clampPercent(raw);
          onChange(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") {
            onEditCancel();
            (event.target as HTMLInputElement).blur();
          }
        }}
        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-right font-mono text-xs tabular-nums text-ink outline-none"
      />
      {suffix && <span className="ml-2xs text-2xs font-medium text-ink-faint">{suffix}</span>}
    </label>
  );
}
