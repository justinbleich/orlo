// =============================================================================
// RN Canvas — studio theme (typed accessors)
//
// Values live in design-tokens.css; this file maps semantic names to the CSS
// variables so components get autocomplete and the value source stays single
// (CSS). Import design-tokens.css once at the app root.
//
// CHROME ONLY. Never style RN canvas content with these — that content is styled
// by the document's RNStyle. See STUDIO-UI.md.
// =============================================================================

export const color = {
  // chrome surfaces
  canvas: 'var(--canvas)',
  chrome: 'var(--chrome)',
  chrome2: 'var(--chrome-2)',
  raised: 'var(--raised)',
  line: 'var(--line)',
  lineSoft: 'var(--line-soft)',
  // ink
  ink: 'var(--ink)',
  inkDim: 'var(--ink-dim)',
  inkFaint: 'var(--ink-faint)',
  // accents — one job each (see notes below)
  accent: 'var(--accent)',          // selection / primary / interactive / agent
  accentSoft: 'var(--accent-soft)',
  accentLine: 'var(--accent-line)',
  live: 'var(--live)',              // RESERVED: live / ground-truth / sim only
  liveSoft: 'var(--live-soft)',
  amber: 'var(--amber)',            // caution / diff, sparingly
  // artboard scaffolding (frame chrome only, not RN content)
  art: 'var(--art)',
  art2: 'var(--art-2)',
  artInk: 'var(--art-ink)',
  artDim: 'var(--art-dim)',
  artLine: 'var(--art-line)',
} as const;

export const font = {
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
} as const;

export const text = {
  micro: 'var(--text-micro)',
  '2xs': 'var(--text-2xs)',
  xs: 'var(--text-xs)',
  sm: 'var(--text-sm)',
  base: 'var(--text-base)',
  lg: 'var(--text-lg)',
  xl: 'var(--text-xl)',
} as const;

export const space = {
  xs: 'var(--space-xs)',
  sm: 'var(--space-sm)',
  md: 'var(--space-md)',
  lg: 'var(--space-lg)',
  xl: 'var(--space-xl)',
  '2xl': 'var(--space-2xl)',
} as const;

export const radius = {
  sm: 'var(--radius-sm)',
  base: 'var(--radius)',
  lg: 'var(--radius-lg)',
  pill: 'var(--radius-pill)',
} as const;

// Region dimensions in px (numbers, for measured panels / tldraw geometry).
export const layout = {
  topbar: 50,
  rail: 52,
  leftPanel: 246,
  rightColumn: 336,
  groundTruth: 300,
  workspaceMin: 960,
} as const;

export const canvasGuide = {
  line: 'var(--canvas-grid-line)',
  step: 'var(--canvas-grid-step)',
} as const;

export const theme = { color, font, text, space, radius, layout, canvasGuide } as const;

export type Theme = typeof theme;

// -----------------------------------------------------------------------------
// Optional Tailwind wiring (BUILD.md: Tailwind is for chrome only). In
// tailwind.config, reference the CSS variables so utilities resolve to tokens:
//
//   theme: { extend: {
//     colors: {
//       canvas: 'var(--canvas)', chrome: 'var(--chrome)', accent: 'var(--accent)',
//       live: 'var(--live)', ink: 'var(--ink)', 'ink-dim': 'var(--ink-dim)', ...
//     },
//     borderRadius: { DEFAULT: 'var(--radius)', lg: 'var(--radius-lg)' },
//   }}
//
// Then `bg-chrome text-ink border-line` etc. all map back to the single source.
// -----------------------------------------------------------------------------
