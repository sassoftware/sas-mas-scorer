// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { WidgetType } from '../../../types/uiBuilder';

const svg = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** A small picture of each widget, for the toolbar and the inspector's widget choice. */
export const widgetIcons: Record<WidgetType, React.ReactNode> = {
  number: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="600" fill="currentColor">123</text>
    </svg>
  ),
  text: svg(<><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M7 10v4" /></>),
  textarea: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></>),
  slider: svg(<><path d="M3 12h18" /><circle cx="9" cy="12" r="2.5" fill="currentColor" /></>),
  dropdown: svg(<><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M14 11l2 2 2-2" /></>),
  radio: svg(<><circle cx="7" cy="8" r="2.5" /><circle cx="7" cy="16" r="2.5" /><circle cx="7" cy="16" r="1" fill="currentColor" /><path d="M12 8h8M12 16h8" /></>),
  toggle: svg(<><rect x="3" y="8" width="18" height="8" rx="4" /><circle cx="16" cy="12" r="2.5" fill="currentColor" /></>),
  readonly: svg(<><rect x="6" y="11" width="12" height="9" rx="2" /><path d="M9 11V8a3 3 0 016 0v3" /></>),
  gauge: svg(<><path d="M4 16a8 8 0 0116 0" /><path d="M12 16l4-5" /></>),
  badge: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="8" rx="4" fill="currentColor" /></svg>,
  table: svg(<><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M3 10h18M3 14.5h18M10 5v14" /></>),
  checkbox: svg(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12.5l2.7 2.7L16.5 9" /></>),
  date: svg(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  datetime: svg(<><rect x="3" y="5" width="13" height="13" rx="2" /><path d="M3 9.5h13M7 3v4M12 3v4" /><circle cx="17.5" cy="17.5" r="4" /><path d="M17.5 15.5v2l1.3 1" /></>),
  hidden: svg(<><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" /><path d="M4 20L20 4" /></>),
  markdown: svg(<><path d="M5 6h14M12 6v12" /></>),
};

/** Short names under the icons. */
export const widgetShortLabels: Record<WidgetType, string> = {
  number: '123',
  text: 'Text',
  textarea: 'Text area',
  slider: 'Slider',
  dropdown: 'Dropdown',
  radio: 'Radio',
  toggle: 'Toggle',
  readonly: 'Read only',
  gauge: 'Gauge',
  badge: 'Badge',
  table: 'Table',
  checkbox: 'Checkbox',
  date: 'Date',
  datetime: 'Date & time',
  hidden: 'Hidden',
  markdown: 'Text block',
};
