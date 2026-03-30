// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/** Map raw API direction values to display labels */
export function directionLabel(direction?: string): string {
  if (!direction) return '\u2014';
  switch (direction) {
    case 'none': return 'temp';
    case 'inOut': return 'in/out';
    default: return direction;
  }
}

/** Badge variant for a direction value (maps to our Badge component) */
export function directionBadgeVariant(direction?: string): 'success' | 'info' | 'warning' | 'default' {
  switch (direction) {
    case 'input': return 'success';
    case 'output': return 'info';
    case 'inOut': return 'warning';
    default: return 'default';
  }
}
