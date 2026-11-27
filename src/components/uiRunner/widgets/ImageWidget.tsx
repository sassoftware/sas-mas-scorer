// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../../types/uiBuilder';

/** The image type plain base64 starts with (its first bytes, encoded). */
const SIGNATURES: [string, string][] = [
  ['iVBORw0KGgo', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
  ['Qk', 'image/bmp'],
  ['PHN2Zy', 'image/svg+xml'],
  ['PD94bWwg', 'image/svg+xml'],
];

/**
 * The address to show a returned image from: a data URL as it is, an https
 * link the module returned, or plain base64 whose first bytes say which image
 * type it is. Null when the value is none of these.
 */
export function imageSource(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(v)) return v;
  if (/^https:\/\/\S+$/i.test(v)) return v;
  const compact = v.replace(/\s+/g, '');
  if (compact.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  const hit = SIGNATURES.find(([sig]) => compact.startsWith(sig));
  return hit ? `data:${hit[1]};base64,${compact}` : null;
}

/** A returned image (base64, a data URL or an https link), with the author's alternative text. */
export const ImageWidget: React.FC<{ field: UIField; value: unknown }> = ({ field, value }) => {
  if (value === null || value === undefined || value === '') {
    return <span className="ui-runner__readonly ui-runner__readonly--null">--</span>;
  }
  const src = imageSource(value);
  if (!src) {
    const text = String(value);
    return (
      <span className="ui-runner__readonly">
        Not an image this app can show ({text.length.toLocaleString()} characters{text.length > 40 ? `, starting ${text.slice(0, 24)}…` : `: ${text}`}).
      </span>
    );
  }
  const alt = field.validation?.imageAlt?.trim() || field.label;
  const maxHeight = field.validation?.imageMaxHeight;
  return (
    <figure className="ui-runner__image">
      <a href={src} target="_blank" rel="noopener noreferrer" title="Open the image full size">
        <img src={src} alt={alt} style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined} />
      </a>
    </figure>
  );
};
