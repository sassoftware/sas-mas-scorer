// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * What can be dragged onto the canvas. Native HTML drag and drop; every drag
 * has a click or keyboard equivalent, so dragging is never the only way.
 */

import type React from 'react';
import { WidgetType } from '../../../types/uiBuilder';
import { Direction } from './canvasOps';

export type DragPayload =
  | { kind: 'widget'; widget: WidgetType }
  | { kind: 'param'; name: string; direction: Direction }
  | { kind: 'field'; parameterId: string };

const MIME = 'application/x-mas-scorer-canvas';

export function startDrag(event: React.DragEvent, payload: DragPayload): void {
  event.dataTransfer.setData(MIME, JSON.stringify(payload));
  // Some browsers start no drag without a plain-text entry.
  event.dataTransfer.setData('text/plain', payload.kind === 'widget' ? payload.widget : payload.kind === 'param' ? payload.name : payload.parameterId);
  event.dataTransfer.effectAllowed = payload.kind === 'field' ? 'move' : 'copy';
}

/** True while the drag carries one of ours (the data itself is readable only on drop). */
export function isCanvasDrag(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(MIME);
}

export function readDrag(event: React.DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData(MIME);
    return raw ? (JSON.parse(raw) as DragPayload) : null;
  } catch {
    return null;
  }
}
