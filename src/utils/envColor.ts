// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Per-connection environment color (Electron app).
 *
 * Each saved connection may carry a color; the active connection's color is
 * applied to the app chrome (header) via CSS custom properties so users can
 * tell at a glance which environment they are connected to. When no color is
 * set the properties are removed and the stylesheet falls back to the default
 * SAS branding.
 */

export interface EnvColorPreset {
  name: string;
  value: string;
}

// SAS brand palette
export const ENV_COLOR_PRESETS: EnvColorPreset[] = [
  { name: 'Light Blue', value: '#C4DEFD' },
  { name: 'Midnight Blue', value: '#032954' },
  { name: 'Pink', value: '#DB127D' },
];

interface RGB {
  r: number;
  g: number;
  b: number;
}

const parseHex = (color: string): RGB | null => {
  const match = color.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
};

// WCAG relative luminance (0 = black, 1 = white)
const relativeLuminance = ({ r, g, b }: RGB): number => {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** Contrast of two opaque colors, per WCAG 2.1. */
const contrastRatio = (a: RGB, b: RGB): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** The opaque color an `alpha` layer of `fg` produces over `bg`. */
const blend = (fg: RGB, bg: RGB, alpha: number): RGB => ({
  r: fg.r * alpha + bg.r * (1 - alpha),
  g: fg.g * alpha + bg.g * (1 - alpha),
  b: fg.b * alpha + bg.b * (1 - alpha),
});

// Header text (title, connection name, breadcrumbs) is body text, so both the
// main and the muted foreground carry the AA 4.5:1 requirement.
const MIN_TEXT_CONTRAST = 4.5;
// Preferred alpha per background: dark backgrounds need far more of the white
// than the old 0.75 (only ~3.2:1 on the Pink preset).
const PREFERRED_MUTED_ALPHA_ON_DARK = 0.92;
const PREFERRED_MUTED_ALPHA_ON_LIGHT = 0.65;

const FG_DARK: RGB = { r: 26, g: 26, b: 26 }; // #1a1a1a, the app's body ink
const FG_DARKEST: RGB = { r: 0, g: 0, b: 0 };
const FG_LIGHT: RGB = { r: 255, g: 255, b: 255 };

interface Foreground {
  rgb: RGB;
  css: string;
  /** True when `bg` takes dark text, i.e. it reads as a light surface. */
  lightBackground: boolean;
}

/**
 * The foreground with the most contrast on `bg`.
 *
 * A luminance threshold cannot do this: it picks a side without measuring, so
 * mid-luminance colors (a teal around #00A5A7, an orange around #F58025 — both
 * choosable as custom connection colors) took white text at ~3:1. Comparing
 * the two candidates instead always picks the side that can pass, and pure
 * black covers the narrow band around luminance 0.18 (where the black and
 * white curves cross) in which the softer #1a1a1a alone does not reach 4.5:1.
 * Every possible background therefore clears AA; a sweep of the whole RGB
 * cube at step 3 puts the worst case at exactly 4.50:1 for both foregrounds.
 */
const foregroundFor = (bg: RGB): Foreground => {
  const soft: Foreground = { rgb: FG_DARK, css: '#1a1a1a', lightBackground: true };
  const white: Foreground = { rgb: FG_LIGHT, css: '#ffffff', lightBackground: false };
  const black: Foreground = { rgb: FG_DARKEST, css: '#000000', lightBackground: true };

  const softRatio = contrastRatio(FG_DARK, bg);
  const whiteRatio = contrastRatio(FG_LIGHT, bg);
  // The app's softer ink is preferred whenever it is both the better side and
  // good enough on its own.
  if (softRatio >= whiteRatio && softRatio >= MIN_TEXT_CONTRAST) return soft;
  if (whiteRatio >= MIN_TEXT_CONTRAST) return white;
  // Neither passes: only pure black can still do it, in the band around
  // luminance 0.18 where the two curves cross.
  return contrastRatio(FG_DARKEST, bg) >= whiteRatio ? black : white;
};

/**
 * The muted foreground for `bg`: the preferred alpha when it clears 4.5:1,
 * otherwise the first stronger step that does. Saturated mid-luminance colors
 * such as the Pink preset have too little headroom for a translucent layer to
 * pass on its own. When even the opaque layer cannot pass (only possible if
 * `fg` itself is at the ceiling for this background) the main foreground is
 * returned unchanged, so the muted text is never worse than the main text.
 */
const mutedForeground = (bg: RGB, fg: Foreground): string => {
  const preferred = fg.lightBackground
    ? PREFERRED_MUTED_ALPHA_ON_LIGHT
    : PREFERRED_MUTED_ALPHA_ON_DARK;

  let alpha = preferred;
  while (alpha < 1 && contrastRatio(blend(fg.rgb, bg, alpha), bg) < MIN_TEXT_CONTRAST) {
    alpha = Math.round((alpha + 0.01) * 100) / 100;
  }
  if (alpha >= 1) return fg.css;
  return `rgba(${fg.rgb.r}, ${fg.rgb.g}, ${fg.rgb.b}, ${alpha})`;
};

const ENV_PROPS = [
  '--env-header-bg',
  '--env-header-fg',
  '--env-header-fg-muted',
  '--env-header-hover-bg',
  '--env-header-border',
];

/**
 * Apply (or clear, when null/invalid) the environment color of the active
 * connection. Both foregrounds are measured against the color rather than
 * guessed from its luminance, so every preset and every custom color clears
 * the AA 4.5:1 text requirement.
 */
export const applyEnvironmentColor = (color: string | null | undefined): void => {
  const root = document.documentElement;
  const rgb = color ? parseHex(color) : null;

  if (!rgb) {
    ENV_PROPS.forEach((prop) => root.style.removeProperty(prop));
    return;
  }

  const fg = foregroundFor(rgb);
  const { lightBackground } = fg;
  root.style.setProperty('--env-header-bg', color as string);
  root.style.setProperty('--env-header-fg', fg.css);
  root.style.setProperty('--env-header-fg-muted', mutedForeground(rgb, fg));
  root.style.setProperty(
    '--env-header-hover-bg',
    lightBackground ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)'
  );
  // The header's only rule (`.sas-header__auth`, layout.css) divides the auth
  // block from the rest of the bar; its default `color-mix` edge disappears on
  // some environment colors, so set an explicit one for each side.
  root.style.setProperty(
    '--env-header-border',
    lightBackground ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.2)'
  );
};
