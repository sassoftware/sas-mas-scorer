// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useViewport } from '@xyflow/react';
import type { GroupBox } from '../../flow/layoutGraph';
import { NODE_COLORS } from '../../flow/constants';

/** Group boxes echo the node family they wrap; the label uses the family's `badge` shade so it reads on the light tint. */
const GROUP_STYLES: Record<string, { bg: string; border: string; badgeColor: string; badgeBg: string }> = {
  'sub-decision': {
    bg: 'rgba(253, 234, 235, 0.25)',
    border: NODE_COLORS.decision.border,
    badgeColor: NODE_COLORS.decision.badge,
    badgeBg: NODE_COLORS.decision.bg,
  },
  'parallel': {
    bg: 'rgba(227, 242, 253, 0.25)',
    border: NODE_COLORS.parallel.border,
    badgeColor: NODE_COLORS.parallel.badge,
    badgeBg: NODE_COLORS.parallel.bg,
  },
};

interface GroupBoxesProps {
  groupBoxes: GroupBox[];
}

export default function GroupBoxes({ groupBoxes }: GroupBoxesProps) {
  const { x, y, zoom } = useViewport();

  if (groupBoxes.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        transformOrigin: '0 0',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      {groupBoxes.map((box) => {
        const style = GROUP_STYLES[box.type] ?? GROUP_STYLES['sub-decision'];
        return (
          <div
            key={box.id}
            style={{
              position: 'absolute',
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              backgroundColor: style.bg,
              border: `2px dashed ${style.border}`,
              borderRadius: 8,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: 12,
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 8px',
                borderRadius: 4,
                backgroundColor: style.badgeBg,
                color: style.badgeColor,
                border: `1px solid ${style.border}`,
                whiteSpace: 'nowrap',
              }}
            >
              {box.type === 'parallel' ? '\u2B58 ' : '\u25C7 '}{box.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
