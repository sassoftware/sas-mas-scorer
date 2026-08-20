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

const parseHex = (color: string): { r: number; g: number; b: number } | null => {
  const match = color.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
};

// WCAG relative luminance (0 = black, 1 = white)
const relativeLuminance = ({ r, g, b }: { r: number; g: number; b: number }): number => {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const ENV_PROPS = ['--env-header-bg', '--env-header-fg', '--env-header-fg-muted', '--env-header-hover-bg'];

/**
 * Apply (or clear, when null/invalid) the environment color of the active
 * connection. Foreground colors are chosen for contrast so light environment
 * colors get dark text.
 */
export const applyEnvironmentColor = (color: string | null | undefined): void => {
  const root = document.documentElement;
  const rgb = color ? parseHex(color) : null;

  if (!rgb) {
    ENV_PROPS.forEach((prop) => root.style.removeProperty(prop));
    return;
  }

  const lightBackground = relativeLuminance(rgb) > 0.45;
  root.style.setProperty('--env-header-bg', color as string);
  root.style.setProperty('--env-header-fg', lightBackground ? '#1a1a1a' : '#ffffff');
  root.style.setProperty(
    '--env-header-fg-muted',
    lightBackground ? 'rgba(0, 0, 0, 0.65)' : 'rgba(255, 255, 255, 0.75)'
  );
  root.style.setProperty(
    '--env-header-hover-bg',
    lightBackground ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)'
  );
};
