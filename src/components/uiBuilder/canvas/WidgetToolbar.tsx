// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { WidgetType } from '../../../types/uiBuilder';
import { startDrag } from './dnd';
import { widgetIcons, widgetShortLabels } from './widgetIcons';

/** The widgets the floating toolbar offers, in the design's order, plus a text block. */
export const TOOLBAR_WIDGETS: WidgetType[] = ['number', 'dropdown', 'badge', 'gauge', 'readonly', 'table', 'toggle', 'markdown'];

interface Props {
  /** What activating a tile does, for its accessible name ("apply to clage" / "add a field"). */
  describe: (widget: WidgetType) => { action: string; disabled: boolean };
  onActivate: (widget: WidgetType) => void;
  onDragStateChange: (dragging: boolean) => void;
}

/**
 * The floating widget bar under the canvas. Drag a tile onto a field to change
 * its widget, or onto empty canvas to add a field; clicking does the same for
 * the selected field, or adds one when nothing is selected.
 */
export const WidgetToolbar: React.FC<Props> = ({ describe, onActivate, onDragStateChange }) => (
  <div className="cb-toolbar" role="group" aria-label="Widgets: drag onto the canvas, or click to apply">
    {TOOLBAR_WIDGETS.map(widget => {
      const { action, disabled } = describe(widget);
      return (
        <button
          key={widget}
          type="button"
          className="cb-toolbar__tile"
          draggable={!disabled}
          disabled={disabled}
          aria-label={`${widgetShortLabels[widget]}: ${action}`}
          title={`${widgetShortLabels[widget]}: ${action}`}
          onClick={() => onActivate(widget)}
          onDragStart={(e) => {
            startDrag(e, { kind: 'widget', widget });
            onDragStateChange(true);
          }}
          onDragEnd={() => onDragStateChange(false)}
        >
          <span className="cb-toolbar__icon">{widgetIcons[widget]}</span>
          <span className="cb-toolbar__label">{widgetShortLabels[widget]}</span>
        </button>
      );
    })}
  </div>
);
